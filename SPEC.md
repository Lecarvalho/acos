# ACOS — Agentic Coding Orchestration Schema

**Version:** 0.1 (draft)

ACOS is a schema for a *run manifest*: a small, provider-agnostic document that
describes how an agentic coding session will be executed **before** any model
spends tokens on the work itself.

The goal is control before spend, at the lowest possible overhead. The user
sees which model, which effort, how many steps and roughly how many tokens a
task will take, agrees to it, and then the orchestrator works without
interruption. What actually happened is written down at the end, and later
runs are calibrated from it.

The lifecycle is always the same:

1. The orchestrator reads the user's intent.
2. It sizes the task against the project's limits. If the task does not fit
   one session, it breaks it into as many manifests as it takes, each
   fitting the limits, and writes them as a plan.
3. It composes each manifest from the project's block catalog, presets and
   calibration notes.
4. It shows the manifest (or the plan) and waits for an explicit **GO**.
   Often the session ends here: the manifests are ready, and each runs
   later in its own fresh session.
5. It executes one manifest, stage by stage. When the plan turns out wrong
   it adjusts, logs the drift, and keeps going.
6. It reports what ran and writes the manifest as executed.
7. Later, in a separate session, `calibrate` compares planned and executed
   manifests and updates the project's calibration notes.

This applies to every run, whether the orchestrator does the work itself,
delegates to subagents of the same provider, or calls external models.

---

## 1. Vocabulary

| Term | Meaning |
|------|---------|
| **Orchestrator** | The model or session that composes the manifest and drives execution. It usually also does most of the work. |
| **Block** | A reusable unit of work with one role (explore, plan, implement, review, verify, ...). Blocks live in the catalog. |
| **Stage** | A block instantiated inside a manifest, with concrete provider, model, effort, and adapter. |
| **Adapter** | How a stage is executed: `inline`, `subagent`, `workflow`, or `external`. |
| **Preset** | A named, ordered set of blocks plus loop and gate defaults. Optional. |
| **Catalog** | The project's collection of providers, blocks, and presets. |
| **Limits** | Project-level ceilings for one session: orchestrator tokens, worker tokens, agents, stages. Set in `.acos.yaml`. |
| **Manifest** | The composed, per-run document. Approved at GO. The *planned* manifest. |
| **Plan** | An ordered set of manifests that together complete one intent too big for a single session. Each manifest is a part, sized to the limits, meant to run in its own session. |
| **Part** | One manifest inside a plan. Carries its index and what it assumes done before it. |
| **Drift** | Any difference between the planned manifest and what ran: a stage added, dropped, or re-ordered, a model or effort changed, a check changed. Logged, never re-approved. |
| **Executed manifest** | The manifest as it actually ran, written at the end of the run. Same schema as the planned one plus a `drift` list. |
| **Calibration** | A project-level note, derived from past runs, that says how this repo tends to behave. Read at compose time. |
| **Loop** | The rule that decides whether to repeat, escalate, or stop after a stage fails its check. |
| **Gate** | A point where execution pauses for a human decision. The GO gate is mandatory. |

---

## 2. Lifecycle

### 2.1 Size

Before composing, the orchestrator counts what the intent touches (files,
lines changed, deliverables), derives stages, agents and tokens from
those counts, and compares all of it with the project limits (section 6).
Counts come first because they can be checked; a token guess made first
drifts to whatever the limit allows.

- Fits: compose one manifest. This holds even when the user asked for a
  plan: the orchestrator says the task fits one run and composes a single
  manifest instead.
- Does not fit: propose the cut first, in a few short lines (parts, what
  each does, rough cost each). Nothing is written until the user agrees
  or adjusts it. Then each part becomes a manifest that fits the limits
  on its own, written together as a plan (section 3.2, 8). The user sees
  the whole: how many parts, what each does, what each costs, and the
  total. That is the cost of the task before any of it runs.

A plan is made once and run part by part, each part in its own fresh
session, in order. The planning session usually ends after the plan is
shown. Nothing forces that: a small part may run in the same session, and
a single manifest that fits may run right away. The orchestrator says
which it recommends and why, in one line.

Token figures come from calibration notes when present, otherwise from
the skill's built-in floors (a subagent costs about 150k before it writes
a line; a review about 200k and is expected to fail once). Within a plan,
the actual/estimate ratio of parts already run scales the parts still to
run, and a part that no longer fits is re-cut before its GO. Parts whose
estimates all sit just under a limit are a sign of fitting the guess to
the limit; the orchestrator recounts and cuts further.

The orchestrator may also recommend a fresh session for a single
manifest when the session that composed it already carries a lot of
context (long conversation, wide exploration during sizing) and it
judges the work would suffer. Judgement, not a rule; it depends on the
task, the limits and the user.

### 2.2 Compose

The orchestrator:

- Reads project defaults (`.acos.yaml`) and calibration notes
  (`acos/calibration.md`), both optional.
- Reads the catalog (`acos/catalog/`) and presets (`acos/presets/`).
- Summarises intent in one or two sentences. If intent is ambiguous in a way
  that changes the manifest, asks **one** clarifying question, then proceeds.
- Composes the fewest stages that reach the intent. `implement` alone is a
  complete manifest. Presets are a convenience, not a requirement.
- Estimates tokens per stage and for the orchestrator. Estimates are
  rough and advisory, but they are what the user approves.

### 2.3 Present

The manifest is written to disk and summarised on screen. The summary is
short: a header and one line per stage. The user must be able to read
from it:

- intent, and the part index if the manifest belongs to a plan
- ordered stages with adapter, provider, model, effort
- the estimate against the limits
- where the full file is

Loop rules, prompts, scope and everything else stay in the file. The
full manifest is printed only when the user asks for it. A plan is
presented the same way: one line per part, files on disk, no manifest
contents. The terminal is for short sentences; files are for reading.

### 2.4 GO gate

Execution does not start until the user says GO (or the project's configured
equivalent). Any change requested at this point produces a new manifest, which
is shown again.

This gate cannot be disabled by a preset. A project may set
`gates.go: auto` for fully unattended runs, but that is a project-level,
human-authored choice, never a preset default.

### 2.5 Execute

- The manifest is written to `runs/<run-id>/manifest.yaml` before the first
  stage starts. It is never edited afterwards.
- Stages run in order. A stage's `adapter` decides how it runs.
- Each stage produces a stage record in `runs/<run-id>/log.yaml`: start, end,
  provider, model, tokens (if known), outcome, and any check output.
- When the plan turns out wrong, the orchestrator changes course and keeps
  going. The change is a **drift** entry in the log (2.7). It does not
  stop for approval.

### 2.6 Loop

After a stage with a `check`, the orchestrator evaluates the check:

- pass: continue to the next stage.
- fail: apply the stage's `on_fail` rule (or the manifest-level default).

`on_fail` options:

| Value | Behaviour |
|-------|-----------|
| `retry` | Run the same stage again, up to `max_iterations`. |
| `escalate` | Run the same stage again with the next model in `escalation`. When the list is exhausted, behave as `retry`. |
| `ask` | Pause and ask the user. |
| `stop` | End the run, report failure. |

When `max_iterations` is exhausted the run ends and reports failure.

### 2.7 Drift

Runs need adjusting in flight: a stage turns out unnecessary, a model
should be swapped, a verify command was wrong, one more stage is needed.
The orchestrator makes the change, appends a drift entry to the log, and
continues. Nothing is re-approved mid-run.

```yaml
drift:
  - at_stage: implement
    change: "stages[review]: dropped"
    reason: "two-line change, orchestrator reviewed inline"
  - at_stage: implement
    change: "stages[implement].check.command: pnpm test -> pnpm typecheck && pnpm test"
    reason: "change touches exported types"
```

The orchestrator pauses for the user in exactly two cases:

1. a stage's `on_fail` is `ask` and its check failed;
2. `gates.per_stage` or a stage `gate` says so.

Everything else, including retries, escalation, dropped stages, swapped
models, changed checks and going past the estimate, is drift and goes to
the log only. A running session cannot measure its own token use
reliably, so limits are not checked mid-run. Whether a run outgrew its
limits is a question for `calibrate`, comparing `estimate` with `actual`.

### 2.8 Report and executed manifest

At the end the orchestrator writes `runs/<run-id>/manifest.executed.yaml`:
the planned manifest with the stages as they actually ran (added, dropped,
re-ordered, models and efforts as used), an `actual` block next to
`estimate`, and the `drift` list copied from the log. Same schema.

The final report includes: manifest id, outcome, each stage's outcome and
iterations, drift in one line each, actual versus estimated tokens where
known, what remains in the plan if any, and a summary of the changes made.

When the manifest is a part of a plan, the plan file's entry for that
part is updated with the outcome, and the report names the next part to
run.

### 2.9 Calibrate

`calibrate` is run on its own, not inside a work session. It reads the
planned and executed manifests and logs under `runs/`, compares them, and
writes `acos/calibration.md`: a short, human-readable note on how this
repo behaves. Compose reads it as a prior. Section 7 describes the file.

---

## 3. Manifest structure

A manifest is YAML (JSON is also valid). Field reference below; formal
constraints live in `schema/acos.schema.json`.

### 3.1 Top level

```yaml
acos: "0.1"            # schema version, required
id: string             # run id, required. Orchestrator generates it.
intent: string         # one or two sentence summary, required
part: Part             # optional; present when the manifest belongs to a plan
preset: string         # preset name this was derived from, optional
scope: Scope           # optional
stages: [Stage]        # required, at least one
loop: Loop             # optional, manifest-level defaults
gates: Gates           # optional
limits: Limits         # optional; copied from .acos.yaml, may be overridden per run
estimate: Estimate     # optional, rough
actual: Estimate       # executed manifest only
drift: [Drift]         # executed manifest only
outputs: Outputs       # optional
```

### 3.2 Part (optional)

```yaml
part:
  plan: 2026-09-16-auth-hardening   # plan id; the plan file is runs/<plan>/plan.yaml
  index: 2
  of: 3
  assumes: "Part 1 done: refresh-on-401 merged, tests in tests/auth/refresh.test.ts."
```

`assumes` states what the part expects to find in the tree when it
starts, so a fresh session can check it before GO.

### 3.3 Scope (optional)

Hints about where the work is expected to happen. Advisory. Stages may read
outside `include`, but should not write outside it unless the user is told.

```yaml
scope:
  include: [src/auth/, tests/auth/]
  exclude: [src/legacy/]
  notes: "Do not touch the public API surface."
```

### 3.4 Stage

```yaml
- name: implement           # unique within the manifest
  block: implement          # catalog block name, optional if role is given
  role: string              # what this stage does, one line
  adapter: inline | subagent | workflow | external
  provider: string          # catalog provider key, e.g. anthropic, openai, ollama
  model: string             # provider model id
  effort: low | medium | high | max   # provider-agnostic; adapters map it
  inputs: [string]          # names of prior stage outputs this stage reads
  outputs: [string]         # names this stage produces
  check: Check              # optional
  on_fail: retry | escalate | ask | stop
  max_iterations: int       # overrides loop default
  escalation: [ModelRef]    # ordered models to try when on_fail is escalate
  gate: bool                # pause for confirmation before this stage
  prompt: string            # optional extra instructions for the worker
```

`ModelRef` is `{provider, model, effort?}`.

### 3.5 Check

A check is what decides pass or fail for a stage.

```yaml
check:
  kind: command | review | none
  command: "npm test"       # for kind: command; exit code 0 means pass
  criteria: string          # for kind: review; a reviewer stage judges it
```

### 3.6 Loop (manifest-level defaults)

```yaml
loop:
  max_iterations: 3
  on_fail: retry
```

Stage-level values override these.

### 3.7 Gates

```yaml
gates:
  go: required | auto       # default required
  per_stage: false          # true = confirm before every stage
```

### 3.8 Limits (optional, advisory)

Ceilings for one run. They act at compose time only: they turn a large
intent into a plan of parts and cap delegation. Nothing checks them mid-run.
`calibrate` reports how often runs outgrew them.

```yaml
limits:
  files: 8                      # created or edited per run, tests included
  lines: 400                    # added plus removed per run
  orchestrator_tokens: 100000   # context the orchestrating session may spend
  worker_tokens: 300000         # sum over subagents, workflows and external calls,
                                # as the harness reports them (re-read context included)
  agents: 3                     # subagent, workflow agent or external calls per run
  stages: 5
  cost: 5.00                    # optional, with currency
  currency: USD
```

All fields optional. Missing fields are unlimited.

### 3.9 Estimate and actual (optional, rough)

`estimate` is produced at compose time and is what the user approves.
`actual` has the same shape and appears only in the executed manifest.
Any field may be absent. Token counts are rough; when the harness does not
report usage, the orchestrator estimates from what it read and wrote.

```yaml
estimate:
  files: 4
  lines: 180
  orchestrator_tokens: 90000
  worker_tokens: 0
  agents: 0
  per_stage:
    - name: implement
      tokens: 90000
  cost: 0.80                    # optional
  currency: USD
  basis: "calibration.md: inline implement in this repo runs 40k + 12k per file"
```

### 3.10 Drift

```yaml
drift:
  - at_stage: string        # stage that was running when the change was made
    change: string          # "path: old -> new" or "stages[<name>]: added | dropped"
    reason: string          # one line
```

### 3.11 Outputs

```yaml
outputs:
  run_dir: runs/2026-09-16-auth-refresh   # default runs/<id>
  write_log: true
```

---

## 4. Adapters

| Adapter | Meaning | Typical use |
|---------|---------|-------------|
| `inline` | The orchestrator does the stage itself in the current session. | The default. Most stages. |
| `subagent` | A subagent of the same harness runs the stage (for example the Claude Code Agent tool). | Independent review, parallel independent pieces, isolating a large read. |
| `workflow` | The harness's workflow engine runs a group of stages. | Three or more independent parallel stages. Rare. |
| `external` | A shell command or API call invokes another provider's model. | Cross-provider review, local models. |

Adapter semantics are defined by the runner, not by this spec. The spec only
requires that every adapter accepts a stage definition and returns a stage
record.

Delegation costs tokens twice: the worker's own context, and the
orchestrator's prompt and result. The default is therefore `inline`, and a
stage is delegated only when isolation, independence or parallelism buys
more than that overhead.

---

## 5. Catalog

The catalog is the project-local source of truth the orchestrator composes
from.

```
acos/
  catalog/
    providers.yaml    # provider -> models, rough prices, invoke method
    blocks/*.yaml     # one block per file
  presets/*.yaml      # one preset per file
  calibration.md      # written by calibrate, read by compose. Optional.
```

### 5.1 Provider entry

```yaml
anthropic:
  invoke:
    subagent: native          # this harness can spawn it directly
    external: "claude -p"     # or a CLI command template
  models:
    claude-sonnet-5:
      price: { input_per_mtok: 3.00, output_per_mtok: 15.00 }   # optional
      effort: [low, medium, high, max]
```

### 5.2 Block

```yaml
name: implement
role: "Make the change described by the plan."
default:
  adapter: inline
  effort: medium
inputs: [plan]
outputs: [diff]
check:
  kind: command
  command: "{{ project.verify }}"
prompt: |
  You are the implementer. Follow the plan exactly. ...
```

### 5.3 Preset

```yaml
name: plan-build-review
description: "Planner, implementer, reviewer as three stages."
stages:
  - { block: plan,      adapter: inline,   effort: high }
  - { block: implement, adapter: inline,   effort: medium,
      on_fail: escalate, escalation: [{ provider: anthropic, model: claude-opus-5 }] }
  - { block: review,    adapter: subagent, effort: high }
loop: { max_iterations: 3, on_fail: retry }
```

Presets refer to blocks by name and override only what differs. Provider and
model may be left out; the orchestrator fills them from `.acos.yaml` defaults.

---

## 6. Project defaults (`.acos.yaml`, optional)

```yaml
acos: "0.1"
provider: anthropic
models:
  fast: claude-haiku-4-5
  balanced: claude-sonnet-5
  strong: claude-opus-5
verify: "npm test"
gates: { go: required }
limits:
  files: 8
  lines: 400
  orchestrator_tokens: 100000
  worker_tokens: 300000
  agents: 3
  stages: 5
```

Catalog files may reference these values with `{{ project.<path> }}`
placeholders (for example `{{ project.verify }}` or
`{{ project.models.strong }}`). The orchestrator substitutes them at compose
time. A placeholder with no value is a compose error, reported before GO.

`limits` is the contract the user cares about most: it is what turns a
large intent into a plan of parts, and what caps delegation. When absent,
the orchestrator uses its own judgement and says so in the estimate basis.

---

## 7. Calibration (`acos/calibration.md`, optional)

Written by `calibrate`, overwritten each time, meant to be read by a human
and by the orchestrator at compose time. Short: under about 40 lines.

```markdown
# ACOS calibration — <repo>

Based on 6 runs, 2026-09-10 to 2026-09-16. Last calibrated 2026-09-16.

## Shape
- 1 to 3 file changes: implement alone, inline, medium. Review was dropped
  as drift in 4 of 5 such runs.
- New module or cross-package change: plan (inline, high) + implement
  (inline) + review (subagent, strong).

## Cost
- implement, inline: 40k + about 12k per file touched.
- any subagent: about 150k before its first edit, then 15k per file.
- review, subagent: about 200k worker tokens; failed first time in 2 of 6
  runs, fix inline cost about 30k.

## Recurring drift
- verify command extended with `pnpm typecheck` in 3 runs. Consider
  changing `.acos.yaml` verify.
- explore stage dropped every time it was planned.

## Notes
- First `pnpm test` after a checkout takes 4 minutes; do not count it as a
  failed check.
```

Sections are fixed (Shape, Cost, Recurring drift, Notes) so compose can
read them reliably. Content is free text.

---

## 8. Plan (`runs/<plan-id>/plan.yaml`)

Written when an intent does not fit one session. The plan directory holds
one subdirectory per part, each an ordinary run directory:

```
runs/2026-09-16-auth-hardening/
  plan.yaml
  1-refresh-on-401/manifest.yaml
  2-logout/manifest.yaml
  3-session-persistence/manifest.yaml
```

```yaml
acos: "0.1"
id: 2026-09-16-auth-hardening
intent: "Full auth hardening: silent refresh on 401, logout endpoint, session persistence."
limits: { orchestrator_tokens: 100000, agents: 3, stages: 5 }
parts:
  - index: 1
    dir: 1-refresh-on-401
    summary: "Silent refresh on 401 in AuthClient, with tests."
    estimate: { files: 3, orchestrator_tokens: 75000, worker_tokens: 0, agents: 0 }
    actual:   { files: 4, orchestrator_tokens: 90000, worker_tokens: 0, agents: 0 }
    status: done          # planned | done | failed
  - index: 2
    dir: 2-logout
    summary: "Logout endpoint and UI action."
    estimate: { files: 5, orchestrator_tokens: 95000, worker_tokens: 0, agents: 0 }
    status: planned
  - index: 3
    dir: 3-session-persistence
    summary: "Persist session across reloads."
    estimate: { files: 4, orchestrator_tokens: 85000, worker_tokens: 0, agents: 0 }
    status: planned
estimate: { orchestrator_tokens: 255000, worker_tokens: 0, agents: 0, sessions: 3 }
```

Every part's manifest is complete on its own: it can be attached to a
work item and run months later in a session that knows nothing else. The
plan file is the index and the running status. Parts run in order; a
part's manifest may state in `part.assumes` what it expects earlier parts
to have left in the tree.

---

## 9. Non-goals for 0.1

- Live pricing lookup.
- Enforcement of limits, hard or soft, during a run.
- Cross-run scheduling or queues.
- Defining adapter internals. Runners own that.
- Mid-run re-approval. The planned manifest is approved once; what
  actually ran is recorded, not re-negotiated.

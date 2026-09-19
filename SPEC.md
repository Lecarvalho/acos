# ACOS — Agentic Coding Orchestration Schema

**Version:** 0.1 (draft)

ACOS is a schema for a *run manifest*: a small, provider-agnostic document that
describes how an agentic coding session will be executed **before** any model
spends tokens on the work itself.

The goal is control before spend, at the lowest possible overhead. The user
sees which model, which effort where one can be set, how many steps and
roughly how many tokens a task will take, agrees to it, and then the
orchestrator works without interruption. What actually happened is written down at the end, and later
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
6. It reports what ran and closes the run log.
7. Later, in a separate session, `calibrate` compares manifests with their
   run logs and updates the project's calibration notes.

This applies to every run, whether the orchestrator does the work itself,
delegates to subagents of the same provider, or calls external models.

---

## 1. Vocabulary

| Term | Meaning |
|------|---------|
| **Orchestrator** | The model or session that composes the manifest and drives execution. It usually also does most of the work. |
| **Block** | A reusable unit of work with one role (explore, plan, implement, review, verify, ...). Blocks live in the catalog. |
| **Stage** | A block instantiated inside a manifest, with an adapter and, when it is delegated, a concrete provider, model and effort. An inline stage has the session's, which the manifest cannot set. |
| **Adapter** | How a stage is executed: `inline`, `subagent`, `workflow`, or `external`. |
| **Preset** | A named, ordered set of blocks plus loop and gate defaults. Optional. |
| **Catalog** | The project's collection of providers, blocks, and presets. |
| **Limits** | Project-level ceilings for one session: orchestrator tokens, worker tokens, agents, stages. Set in `.acos.yaml`. |
| **Manifest** | The composed, per-run document. Approved at GO. The *planned* manifest. |
| **Plan** | An ordered set of manifests that together complete one intent too big for a single session. Each manifest is a part, sized to the limits, meant to run in its own session. |
| **Part** | One manifest inside a plan. Carries its index, what it assumes done before it, and which parts it waits for. Parts that wait for none of each other may run in parallel sessions. |
| **Slice** | A set of files one implementer owns for the length of a stage. Slices in one part are disjoint, so their stages can run at the same time. |
| **Fan-out** | A part whose orchestrator plans once, then hands each slice to its own worker in parallel and verifies the merged tree. The only shape in which delegation saves time. |
| **Vertical cut** | A part or slice that carries one capability through every layer it touches, so a file has exactly one owner in the whole plan. Its opposite, one layer per part, makes every later part re-read what an earlier part already read. |
| **Startup load** | What a session or a worker holds before it reads a line of the repo: system prompt, tool schemas, MCP servers, project memory, skill descriptions. Measured once by `init` into `.acos.yaml`, and the floor every estimate starts from. |
| **Drift** | Any difference between the planned manifest and what ran: a stage added, dropped, or re-ordered, a model or effort changed, a check changed. Logged, never re-approved. |
| **Run log** | `runs/<run-id>/log.yaml`: what ran, stage by stage, with check results, drift and actual counts. With the manifest it is the whole record of a run. |
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

**Nothing starts at zero.** A session holds its harness before it reads
a line of the repo: system prompt, tool schemas, MCP servers, project
memory, skill descriptions. `.acos.yaml` records that startup load
(section 6), measured once by `init`. What a part may spend on the work
is `limits.orchestrator_tokens` minus `startup.orchestrator`, and a
delegated stage's floor starts at `startup.subagent`. An estimate that
ignores it is wrong by a fixed amount on every part, always in the same
direction.

**Cut vertically.** Group the counted files so each file has exactly one
owner in the plan, and cut along what the change does — a capability, a
route, a screen, carried through every layer it touches — not along what
the files are. One layer per part (all models, then all services, then
all views) makes every part read files an earlier part already read, and
the plan pays for the same file two or three times, each time behind a
fresh session's startup. A file two capabilities both need goes to the
earliest part that needs it; later parts take it as given through
`assumes`, and the plan says so in one line. A file owned by three or
more parts means the cut is horizontal: recut. Each part lists its files
in `owns` (section 8), so overlap is visible before GO.

**One more agent before one more part.** Splitting an intent costs a
whole session's startup, a handoff written and read, and the gap between
sessions. Adding a worker inside a part costs that worker's startup, on
a cheaper tier, in parallel, and it dies when it returns. So when the
counted work does not fit one context, the first move is slices in one
session, and a new part only when the work has a real dependency, or the
session could not verify the merged tree, or the slices together would
outgrow what one session can hold at once.

**Slices and fan-out.** The limits on files and lines bound what one
implementer holds in its head, not what one session may do: a session
running three slices may legitimately touch three times `limits.files`.
When the counted files fall into two or more groups that share no file, and each
group is worth an implementer of its own (about three files or more), the
orchestrator may compose one part with a slice per group instead of a part
per group: one inline `plan` stage reads the area once and writes a brief
per slice; an `implement` stage per slice, delegated to a balanced-tier
model, runs in parallel with the others; one inline `verify` runs on the
merged tree. Each slice must fit `limits.files` and `limits.lines` on its
own; the number of slices is capped by `limits.agents`. A file two groups
both need (a shared stylesheet, a types module) is owned by exactly one
slice or moved into a small part that runs first. Fan-out is not taken for
a single group: there the orchestrator implements inline, which is
cheaper and faster than one delegation — unless what remains of its
budget after startup cannot hold that group, and then the group goes to
one implementer rather than to a second part.

**Order between parts.** A part names the parts it waits for. The default
is the part before it, which keeps plans sequential. Parts in different
subtrees that wait for none of each other may run at the same time in
separate sessions; the plan says so, and the user decides whether to open
a second terminal.

A plan is made once and run part by part, each part in its own fresh
session, in the order the plan allows. The planning session usually ends
after the plan is shown. Nothing forces that: a small part may run in the same session, and
a single manifest that fits may run right away. The orchestrator says
which it recommends and why, in one line.

Token figures come from calibration notes when present, otherwise from
the skill's built-in floors (a subagent costs about 150k before it writes
a line; a review about 200k and is expected to fail once). Worker floors
are measured end to end and already contain the worker's startup load;
the orchestrator's is added once per part, on top. Within a plan,
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
- ordered stages with adapter, and provider, model and effort for the
  delegated ones; an inline stage shows the session instead
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
- Stages run in order. A stage's `adapter` decides how it runs. Consecutive
  delegated stages whose `inputs` do not name each other's `outputs` and
  whose `owns` lists share no path run at the same time; the summary marks
  them before GO. A stage whose `owns` overlaps a concurrent stage's is a
  compose error.
- Each stage produces a stage record in `runs/<run-id>/log.yaml`: start, end,
  provider, model, tokens (only when the adapter reports them), outcome, and
  the shortest decisive check output.
- A stage output becomes a file under `runs/<run-id>/artifacts/` only when
  another context reads it: a delegated stage takes it as input, a gate
  shows it, or a later part needs it. Output passed between inline stages
  stays in the orchestrator's context, and `git diff` is the diff.
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
| `escalate` | Run the same stage again with the next model in `escalation`. When the list is exhausted, behave as `retry`. From an inline stage the retry is delegated to that model: a session cannot change its own model or effort. |
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

### 2.8 Report and run log

The run log is the only record a run writes about itself. The manifest
says what was planned; the log's stage records and `drift` say what ran.
Nothing restates the manifest.

```yaml
# runs/<run-id>/log.yaml
manifest: 2026-09-17-lanes-core
sessions: ["claude:86ea4acb-95fc-487b-9ff4-119fa2bfeb5d"]   # harness session ids, when exposed
started: "2026-09-17T10:20:04-04:00"
drift:
  - at_stage: plan
    change: "scope: 4 files -> 8"
    reason: "shared bar extraction keeps lanes and single chart identical"
stages:
  - name: plan
    iteration: 1
    adapter: inline
    provider: anthropic
    model: claude-opus-5
    started: "2026-09-17T10:20:04-04:00"
    ended: "2026-09-17T10:23:22-04:00"
    check: none
    outcome: pass
  - name: implement
    iteration: 1
    adapter: inline
    provider: anthropic
    model: claude-opus-5
    started: "2026-09-17T10:23:22-04:00"
    ended: "2026-09-17T10:30:55-04:00"
    check: "npm run verify:fast && npm run test:ui"
    outcome: pass
    output: "exit 0; 86 files, 841 tests"
ended: "2026-09-17T10:31:58-04:00"
outcome: success            # success | failed | stopped
actual:
  files: 8                  # from git, new files included
  lines: 478
  agents: 0
  worker_tokens: 0          # only what adapters reported
```

A stage record carries `effort` only when the stage was delegated. An
inline stage ran at the session's model and effort, which nothing in the
manifest could set; the log names the model when the harness exposes it.

Token counts in the log are measured or absent, never estimated. An
orchestrator cannot measure its own use, and a guess recorded as `actual`
would only teach `calibrate` the estimate back. Session ids and stage
times let a usage observer outside the run (a session monitor, for
example) supply the missing counts later. Session ids are hints: after a
session reset a harness may still expose the old one, so stage times are
the key.

When the manifest is a part of a plan, the plan file's entry for that part
gets its status and `actual`. A part that later parts build on also writes
`artifacts/handoff.md`: what later parts reuse, decisions they must not
undo, deferred findings with the owning part, and the verify result. It is
read by a fresh session, so it stays short.

A part that changed a visible surface also writes `artifacts/try-it.md`:
what a reader does to see the change, and one cropped screenshot per claim
they can check, captured with `{{ project.shot }}` into
`artifacts/shots/` and carrying a one or two line caption. It is the
part's evidence rather than its summary: the caption says what the crop
shows, and a crop that disagrees with its caption is a defect in the part.
The `evidence` stage that produces it is delegated by default, so the
pixels never enter the orchestrator's context: the implementer ends its
report with one capture line per claim, a balanced-tier worker runs the
captures, looks at each crop, captions it and writes the page, and its
first line is a verdict. `VERDICT: FAIL` on a crop that does not show its
claim is a failed check, handled like a failed review: fixed inline,
recaptured, never deferred. The stage runs while the orchestrator writes
the handoff. A part with no visible surface writes none.

The final report includes: manifest id, outcome, each stage's outcome and
iterations, drift in one line each, actual versus estimated counts where
known, what remains in the plan if any, and a summary of the changes made.
It points at files such as the handoff rather than repeating them, and
names the next part to run when there is one.

### 2.9 Calibrate

`calibrate` is run on its own, not inside a work session. It reads the
manifests, run logs and plan files under `runs/`, compares them, and
writes `acos/calibration.md`: a short, human-readable note on how this
repo behaves. Compose reads it as a prior. Section 7 describes the file.
Token counts missing from the logs come from a usage observer when one
can report on the recorded sessions and stage times; otherwise they stay
unknown.

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
outputs: Outputs       # optional
```

### 3.2 Part (optional)

```yaml
part:
  plan: 2026-09-16-auth-hardening   # plan id; the plan file is runs/<plan>/plan.yaml
  index: 2
  of: 3
  after: [1]                        # parts this one waits for; default: the part before it
  assumes: "Part 1 done: refresh-on-401 merged, tests in tests/auth/refresh.test.ts."
```

`assumes` states what the part expects to find in the tree when it
starts, so a fresh session can check it before GO. `after` lists the parts
whose work this one builds on; `[]` means it may start at any time. Two
parts neither of which is downstream of the other may run in separate
sessions at once.

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
                            # delegated stages only
  model: string             # provider model id; delegated stages only
  effort: low | medium | high | max   # delegated stages only; adapters map it
  inputs: [string]          # names of prior stage outputs this stage reads
  outputs: [string]         # names this stage produces
  owns: [string]            # files or directories only this stage writes; required
                            # on a delegated stage that runs alongside another
  check: Check              # optional
  on_fail: retry | escalate | ask | stop
  max_iterations: int       # overrides loop default
  escalation: [ModelRef]    # ordered models to try when on_fail is escalate
  gate: bool                # pause for confirmation before this stage
  prompt: string            # optional extra instructions for the worker
```

`ModelRef` is `{provider, model, effort?}`.

`provider`, `model` and `effort` belong to a delegated stage. An inline
stage carries none of them: it runs in the session that is executing the
manifest, whose model and reasoning effort are fixed for the whole
session and which no stage can change. A manifest that gives its inline
stages an effort each is describing something no runner can do. Work
that needs a different model or a different effort is delegated, or is a
part of its own, started in a session set up for it. `on_fail: escalate`
on an inline stage therefore delegates the retry to the escalation model
(section 2.6).

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
  files: 8                      # created or edited per context (an inline part, or
                                # one slice), tests included; a fan-out session
                                # legitimately totals more
  lines: 400                    # added plus removed, same per-context meaning
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
`actual` has the same shape and lives in the run log and the plan file,
not in the manifest. Any field may be absent. Estimated token counts are
rough; actual token counts are measured or absent (2.8).

```yaml
estimate:
  files: 4
  lines: 180
  startup_tokens: 40000         # part of orchestrator_tokens: what the session
                                # held before it read anything (section 6)
  orchestrator_tokens: 90000
  worker_tokens: 0
  agents: 0
  per_stage:
    - name: implement
      tokens: 90000
  cost: 0.80                    # optional
  currency: USD
  basis: "startup 40k measured 2026-09-18; calibration.md: inline implement in this repo runs 40k + 12k per file"
```

### 3.10 Drift

Recorded in the run log (2.8), never in the manifest.

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

Two things make the second reading cheap enough to pay for. A delegated
stage runs on a cheaper tier than the orchestrator: a balanced-tier
implementer reads the same files at a fraction of the price, and a
fast-tier worker runs a script for almost nothing. And the worker's
context dies when it returns, while everything the orchestrator reads is
sent again on every later turn of the session. Tier by role, unless a
project or preset says otherwise:

| Role | Tier | Effort | Why |
|------|------|--------|-----|
| size, compose, plan, brief, handoff | orchestrator (strong) | the session's | judgement, reads once |
| explore (map an unknown area) | balanced | low | a wide read whose result is one page |
| implement inside a fan-out | balanced | medium | follows a brief, re-reads only its slice |
| evidence (capture, look, caption) | balanced | low | runs a script and must see the crop |
| review | strong | high | independent judgement over the whole diff |
| verify | none | — | a command |

Effort is a setting of a delegated stage. Inline stages run at whatever
the session runs at; that is why the orchestrator's row names no level.

A single-slice implement stays inline: one delegation there is a second
read with no parallelism to pay for it. The exception is budget: when
what remains of the orchestrator's tokens after its startup load cannot
hold the slice, the slice is delegated to one implementer, which is
cheaper than the fresh session a second part would need.

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
  adapter: inline           # no effort: an inline stage takes the session's.
                            # A delegated instance takes it from the role
                            # table in section 4.
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
  - { block: plan,      adapter: inline }
  - { block: implement, adapter: inline,
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
shot: "node .claude/skills/acos/scripts/shot.mjs"
gates: { go: required }
startup:
  orchestrator: 40000         # what a session of this project holds before it reads
  subagent: 25000             # what a fresh worker holds before its first read
  basis: "claude code /context, empty session, 2026-09-18"
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

`shot` is the capture command the `evidence` block calls; a project whose
interface is not a web page points it at its own, and one with no visible
surface leaves the key out, which is what tells the orchestrator to
compose no evidence stage.

`startup` is the session's floor: system prompt, tool schemas, MCP
servers, project memory and skill descriptions, measured once by `init`
and written with the date and method in `basis`. It moves whenever the
project gains an MCP server, a skill or a memory file, so `init` is
re-run then. When the key is absent, the orchestrator assumes 40000 for
a session and 25000 for a worker and says so in the estimate basis.

`limits` is the contract the user cares about most: it is what turns a
large intent into a plan of parts, and what caps delegation. When absent,
the orchestrator uses its own judgement and says so in the estimate basis.
`limits.files` and `limits.lines` bound one context — an inline part or
one slice of a fan-out — so a session running several slices may exceed
them in total on purpose.

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
- fan-out implementer, balanced tier: about 180k per slice; passed verify
  first time in 5 of 6 slices. Two-slice parts took 14 minutes of work
  against 22 for the same files in sequence.
- evidence, balanced subagent: about 60k; 2 of 9 crops failed their
  caption and were recaptured in the part.
- session startup: 40k, measured 2026-09-12. Parts miss their estimate
  by about that much when it is left out, and by nothing when it is in.
- between parts: median 25 minutes from one part's end to the next
  part's start.

## Recurring drift
- verify command extended with `pnpm typecheck` in 3 runs. Consider
  changing `.acos.yaml` verify.
- explore stage dropped every time it was planned.
- every part since 2026-09-14 ran about 30k over its orchestrator
  estimate, by the same amount: `.acos.yaml` `startup` predates the two
  MCP servers added that week. Re-run `/acos init`.

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
    owns: [src/auth/client.ts, src/auth/refresh.ts, tests/auth/refresh.test.ts]
    estimate: { files: 3, startup_tokens: 40000, orchestrator_tokens: 75000, worker_tokens: 0, agents: 0 }
    actual:   { files: 4, orchestrator_tokens: 90000, worker_tokens: 0, agents: 0 }
    status: done          # planned | done | failed
  - index: 2
    dir: 2-logout
    summary: "Logout endpoint and UI action."
    owns: [src/auth/logout.ts, src/api/routes/logout.ts, src/ui/AccountMenu.tsx, tests/auth/logout.test.ts]
    after: [1]
    estimate: { files: 5, startup_tokens: 40000, orchestrator_tokens: 95000, worker_tokens: 0, agents: 0 }
    status: planned
  - index: 3
    dir: 3-session-persistence
    summary: "Persist session across reloads. Two slices: storage adapter, client wiring."
    owns: [src/auth/storage/, src/auth/session.ts, src/ui/SessionBoundary.tsx, tests/auth/session.test.ts]
    after: [1]                      # not on 2: may run alongside it
    estimate: { files: 7, startup_tokens: 40000, orchestrator_tokens: 60000, worker_tokens: 380000, agents: 2 }
    status: planned
estimate: { orchestrator_tokens: 250000, worker_tokens: 380000, agents: 2, sessions: 3 }
```

`owns` is the part's files, and the plan's cut is checkable from it: a
path appears under one part, or the plan says in one line why a second
part must write it too. Paths under three or more parts mean the cut
ran along layers instead of capabilities (section 2.1) and the plan is
recut rather than approved. The total `orchestrator_tokens` counts one
`startup_tokens` per session, which is the honest price of a part more.

Every part's manifest is complete on its own: it can be attached to a
work item and run months later in a session that knows nothing else. The
plan file is the index and the running status. Parts run in the order
`after` allows; a part's manifest may state in `part.assumes` what it
expects earlier parts to have left in the tree. A part with more than one
slice is one session with several workers, and `sessions` counts it once.

---

## 9. Non-goals for 0.1

- Live pricing lookup.
- Enforcement of limits, hard or soft, during a run.
- Cross-run scheduling or queues.
- Defining adapter internals. Runners own that.
- Mid-run re-approval. The planned manifest is approved once; what
  actually ran is recorded, not re-negotiated.

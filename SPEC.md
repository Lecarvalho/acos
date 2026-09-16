# ACOS — Agentic Coding Orchestration Schema

**Version:** 0.1 (draft)

ACOS is a schema for a *run manifest*: a small, provider-agnostic document that
describes how an agentic coding session will be executed **before** any model
spends tokens on the work itself.

The lifecycle is always the same:

1. The orchestrator reads the user's intent.
2. It composes a manifest from the project's block catalog and presets.
3. It shows the manifest to the user.
4. It waits for an explicit **GO**.
5. It executes the manifest, stage by stage, following the loop rules.
6. It reports what ran.

This applies to every run, whether the orchestrator does the work itself,
delegates to subagents of the same provider, or calls external models.

---

## 1. Vocabulary

| Term | Meaning |
|------|---------|
| **Orchestrator** | The model or session that composes the manifest and drives execution. It may also be a worker. |
| **Block** | A reusable unit of work with one role (explore, plan, implement, review, verify, ...). Blocks live in the catalog. |
| **Stage** | A block instantiated inside a manifest, with concrete provider, model, effort, and adapter. |
| **Adapter** | How a stage is executed: `inline`, `subagent`, `workflow`, or `external`. |
| **Preset** | A named, ordered set of blocks plus loop and gate defaults. Presets are the thing people import. |
| **Catalog** | The project's collection of providers, blocks, and presets. |
| **Manifest** | The composed, per-run document. Frozen after GO. |
| **Loop** | The rule that decides whether to repeat, escalate, or stop after a stage fails its check. |
| **Gate** | A point where execution pauses for a human decision. The GO gate is mandatory. |

---

## 2. Lifecycle

### 2.1 Compose

The orchestrator:

- Reads project defaults (`.acos.yaml`, optional).
- Reads the catalog (`acos/catalog/`) and presets (`acos/presets/`).
- Summarises intent in one or two sentences. If intent is ambiguous in a way
  that changes the manifest, asks **one** clarifying question, then proceeds.
- Selects a preset (explicit from the user, from project defaults, or by
  judgement) and fills in stages.
- Optionally estimates cost. Estimates are rough and advisory.

### 2.2 Present

The manifest is shown in full. At minimum the user must see:

- intent summary
- ordered stages with adapter, provider, model, effort
- loop rules
- any budget or cost estimate, if present
- what will be written to disk

### 2.3 GO gate

Execution does not start until the user says GO (or the project's configured
equivalent). Any change requested at this point produces a new manifest, which
is shown again.

This gate cannot be disabled by a preset. A project may set
`gates.go: auto` for fully unattended runs, but that is a project-level,
human-authored choice, never a preset default.

### 2.4 Execute

- The manifest is written to `runs/<run-id>/manifest.yaml` before the first
  stage starts.
- Stages run in order. A stage's `adapter` decides how it runs.
- Each stage produces a stage record in `runs/<run-id>/log.yaml`: start, end,
  provider, model, tokens (if known), outcome, and any check output.
- The manifest is not modified during execution. Deviations (for example an
  escalation that chose a different model) are recorded in the log, not the
  manifest.

### 2.5 Loop

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

### 2.6 Report

The final report includes: manifest id, each stage's outcome, iterations
used, actual token usage or cost if known versus estimate, and a summary of
the changes made.

---

## 3. Manifest structure

A manifest is YAML (JSON is also valid). Field reference below; formal
constraints live in `schema/acos.schema.json`.

### 3.1 Top level

```yaml
acos: "0.1"            # schema version, required
id: string             # run id, required. Orchestrator generates it.
intent: string         # one or two sentence summary, required
preset: string         # preset name this was derived from, optional
scope: Scope           # optional
stages: [Stage]        # required, at least one
loop: Loop             # optional, manifest-level defaults
gates: Gates           # optional
budget: Budget         # optional, advisory
estimate: Estimate     # optional, rough
outputs: Outputs       # optional
```

### 3.2 Scope (optional)

Hints about where the work is expected to happen. Advisory. Stages may read
outside `include`, but should not write outside it unless the user is told.

```yaml
scope:
  include: [src/auth/, tests/auth/]
  exclude: [src/legacy/]
  notes: "Do not touch the public API surface."
```

### 3.3 Stage

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

### 3.4 Check

A check is what decides pass or fail for a stage.

```yaml
check:
  kind: command | review | none
  command: "npm test"       # for kind: command; exit code 0 means pass
  criteria: string          # for kind: review; a reviewer stage judges it
```

### 3.5 Loop (manifest-level defaults)

```yaml
loop:
  max_iterations: 3
  on_fail: retry
```

Stage-level values override these.

### 3.6 Gates

```yaml
gates:
  go: required | auto       # default required
  per_stage: false          # true = confirm before every stage
```

### 3.7 Budget (optional, advisory)

A ceiling the user cares about. It does **not** stop execution. When the
orchestrator knows it has crossed a ceiling, it says so in the report and,
if `on_exceed: ask`, pauses once to ask.

```yaml
budget:
  currency: USD
  ceiling: 5.00
  on_exceed: note | ask     # default note
```

### 3.8 Estimate (optional, rough)

Produced at compose time. Always approximate. May be absent entirely, and any
field inside it may be absent.

```yaml
estimate:
  total_cost: 1.20
  currency: USD
  per_stage:
    - name: implement
      tokens: 40000
      cost: 0.80
  basis: "catalog price table, tokens guessed from scope size"
```

### 3.9 Outputs

```yaml
outputs:
  run_dir: runs/2026-09-16-auth-refresh   # default runs/<id>
  write_log: true
```

---

## 4. Adapters

| Adapter | Meaning | Typical use |
|---------|---------|-------------|
| `inline` | The orchestrator does the stage itself in the current session. | Small tasks, planning, final review. |
| `subagent` | A subagent of the same harness runs the stage (for example the Claude Code Agent tool). | Parallel or isolated stages. |
| `workflow` | The harness's workflow engine runs the stage or a group of stages. | Fan-out review, verify pipelines. |
| `external` | A shell command or API call invokes another provider's model. | Cross-provider review, cheap implementers, local models. |

Adapter semantics are defined by the runner, not by this spec. The spec only
requires that every adapter accepts a stage definition and returns a stage
record.

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
  adapter: subagent
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
  - { block: implement, adapter: subagent, effort: medium,
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
preset: plan-build-review
provider: anthropic
models:
  fast: claude-haiku-4-5
  balanced: claude-sonnet-5
  strong: claude-opus-5
verify: "npm test"
gates: { go: required }
budget: { ceiling: 5.00, currency: USD }
```

Catalog files may reference these values with `{{ project.<path> }}`
placeholders (for example `{{ project.verify }}` or
`{{ project.models.strong }}`). The orchestrator substitutes them at compose
time. A placeholder with no value is a compose error, reported before GO.

---

## 7. Non-goals for 0.1

- Live pricing lookup.
- Hard enforcement of budgets.
- Cross-run scheduling or queues.
- Defining adapter internals. Runners own that.

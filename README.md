# ACOS — Agentic Coding Orchestration Schema

A schema and a skill for one habit: **decide how a run will happen before
any model spends tokens on it.**

Every agentic coding run starts with a *run manifest*. The orchestrator
composes it from the project's block catalog, shows it, waits for GO, then
executes it. The manifest says which stages run, in what order, on which
provider and model, at what effort, with what loop and gates, and, roughly,
what it might cost.

It is provider-agnostic. The same manifest can run in-session, through
subagents of the same harness, through a workflow engine, or by calling
external CLIs for other providers. Mixing is normal: plan in-session,
implement with a mid-tier model, review with a different provider.

## The loop

```
intent  ->  manifest  ->  GO?  ->  stage 1 -> check -> stage 2 -> ...  ->  report
            (shown)      (you)     (retry / escalate / ask / stop on fail)
```

## What is in this repo

| Path | What |
|------|------|
| `SPEC.md` | The schema semantics: vocabulary, lifecycle, fields, adapters, catalog. |
| `schema/acos.schema.json` | JSON Schema (2020-12) for a manifest. |
| `schema/manifest.example.yaml` | A complete manifest. |
| `acos/catalog/providers.yaml` | Providers, models, rough prices, how to invoke them. |
| `acos/catalog/blocks/` | Reusable stage definitions: explore, plan, implement, review, verify. |
| `acos/presets/` | Optional starting pipelines: `solo`, `plan-build-review`. Runs compose ad hoc from blocks by default; `/acos save-preset` promotes a good run into a preset. |
| `skills/acos/` | The orchestrator skill for Claude Code, plus adapter notes. |
| `.acos.example.yaml` | Project defaults template. |
| `install.md` | How to drop this into a project. |

## Design choices

- **The GO gate is mandatory.** Only a project's own `.acos.yaml` can set
  it to `auto`. Presets cannot.
- **Budget and estimates are advisory.** They inform the decision at the
  gate. They never stop a run.
- **Scope is optional and advisory.** Hints, not a sandbox.
- **Presets reference model tiers** (`fast`, `balanced`, `strong`), not
  model ids. Swap providers in `.acos.yaml` without touching presets.
- **The manifest is frozen after GO.** Deviations go in the run log.
- **Nothing to hand-edit.** `/acos init` derives `.acos.yaml` from the
  repo. Presets grow out of real runs, not templates.

## Status

Version 0.1, being validated on real projects. Expect field changes.

## Validate a manifest

```
npx ajv-cli@5 validate --spec=draft2020 -s schema/acos.schema.json -d my-manifest.json
```

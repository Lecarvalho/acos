# ACOS — Agentic Coding Orchestration Schema

A schema and a skill for one habit: **decide how a run will happen before
any model spends tokens on it, then get out of the way.**

Every agentic coding run starts with a *run manifest*. The orchestrator
sizes the task against the project's session limits, composes a manifest
from the block catalog, shows it, waits for GO, then executes it without
further interruptions. A task too big for one session becomes a *plan*:
several manifests, each sized for its own session, written to disk up
front so the user sees the whole cost and can run each part whenever
they like, in a fresh session, or attach them to a work item. The
manifest says which stages run, on which provider and model, at what
effort, with how many agents, and roughly how many tokens. When the plan
turns out wrong mid-run the orchestrator adjusts, logs the drift and keeps
going; at the end it closes the run log with what actually ran.
`/acos calibrate` reads those over time so the next manifest for this
repo is closer to right.

It is provider-agnostic. The same manifest can run in-session, through
subagents of the same harness, through a workflow engine, or by calling
external CLIs for other providers. Mixing is normal: plan in-session,
implement with a mid-tier model, review with a different provider.

## The loop

```
intent -> size -> manifest -> GO? -> stage 1 -> check -> ... -> report + run log
                  (summary)   (you)   (drift logged, not re-approved)

too big:  intent -> size -> cut OK? -> plan: manifest 1..n on disk  -> session per part:
                                                                     /acos run <plan> <i>

later, own session:   /acos calibrate  ->  acos/calibration.md  ->  next compose
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
| `acos/calibration.md` | Not shipped. Written per project by `/acos calibrate` from past runs; read at compose time. |
| `skills/acos/` | The orchestrator skill for Claude Code, plus adapter notes. |
| `skills/acos/scripts/shot.mjs` | Captures a cropped PNG of a running page with headless Chrome or Edge, so a part can show what it changed instead of describing it. No dependencies. |
| `.acos.example.yaml` | Project defaults template. |
| `install.md` | How to drop this into a project. |

## Design choices

- **The GO gate is mandatory.** Only a project's own `.acos.yaml` can set
  it to `auto`. Presets cannot.
- **Limits and estimates are advisory.** Limits (orchestrator tokens,
  agents, stages) shape the manifest and split big tasks into a plan at
  compose time.
  Nothing checks them mid-run; `/acos calibrate` does, afterwards.
- **One session per manifest.** A plan's parts are complete manifests
  meant for fresh sessions. The planning session often ends at the plan.
  Not a hard rule; small parts may run where they were planned.
- **Inline by default.** The orchestrator does the work. A stage is
  delegated only when independence, isolation or parallelism pays for the
  round trip. Three files do not get ten subagents.
- **Scope is optional and advisory.** Hints, not a sandbox.
- **Presets reference model tiers** (`fast`, `balanced`, `strong`), not
  model ids. Swap providers in `.acos.yaml` without touching presets.
- **After GO, no re-approval.** Changes in flight are drift: applied
  and recorded in the run log. The user
  is asked again only on `on_fail: ask` or a gate.
- **Calibration is a separate step.** `/acos calibrate` compares manifests
  with their run logs across runs and writes a short note the next
  compose reads. Runs stay small; learning happens between them.
- **Nothing to hand-edit.** `/acos init` derives `.acos.yaml` from the
  repo. Presets grow out of real runs, not templates.

## Status

Version 0.1, being validated on real projects. Expect field changes.

## Validate a manifest

```
npx ajv-cli@5 validate --spec=draft2020 -s schema/acos.schema.json -d my-manifest.json
```

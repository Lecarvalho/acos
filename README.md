# ACOS — Agentic Coding Orchestration Schema

A schema and a skill for one habit: **decide how a run will happen before
any model spends tokens on it, then get out of the way.**

Every agentic coding run starts with a *run manifest*. The orchestrator
sizes the task against the project's session limits, composes a manifest
from the block catalog, shows it, waits for GO, then executes it without
further interruptions. A task too big for one session becomes a *plan*:
several manifests, each sized for its own session, written to disk up
front so the user sees every context reservation and can run each part whenever
they like, in a fresh session, or attach them to a work item. The
manifest says which stages run, on which provider and model, at what
effort where a model can be told one, with how many agents, and how much
context each participant conservatively reserves — counted from what the
session already holds at startup, not from zero. Aggregate reservation is
labelled separately and is not presented as observed usage. When the plan
turns out wrong mid-run the
orchestrator adjusts, logs the drift and keeps going; at the end it closes the run log with what actually ran.
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

too big:  intent -> size -> mode? -> cut OK? -> plan: manifest 1..n on disk
          single: this session runs every part, workers in parallel waves
          sequential: a session per part, /acos run <plan> <i>
          parallel: sessions side by side on parts sharing no file

later, own session:   /acos calibrate  ->  calibration.md  ->  next compose
```

## What is in this repo

| Path | What |
|------|------|
| `SPEC.md` | The schema semantics: vocabulary, lifecycle, fields, adapters, catalog. |
| `schema/acos.schema.json` | JSON Schema (2020-12) for a manifest. |
| `schema/manifest.example.yaml` | A complete manifest. |
| `skills/acos/` | The skill: everything a project installs, as one folder. |
| `skills/acos/SKILL.md` | The orchestrator procedure in one screen: files, commands, the loop, principles. |
| `skills/acos/references/` | Detail each step loads when it runs: sizing, manifest, execute, maintain (init, calibrate, save-preset), adapters, workflow. |
| `skills/acos/catalog/providers.yaml` | Providers: tier-to-alias mapping (`strong: opus`), effort levels, how to invoke them. Families, not ids (`opus`, `sol`); the Codex command adds the generation (`gpt-6-`). |
| `skills/acos/catalog/blocks/` | Reusable stage definitions: explore, plan, contract, implement, evidence, review, verify. |
| `skills/acos/presets/` | Optional starting pipelines: `solo`, `plan-build-review`, `fan-out`. Runs compose ad hoc from blocks by default; `/acos save-preset` promotes a good run into a preset. |
| `skills/acos/config.example.yaml` | Shape of a project's `config.yaml`, which `/acos init` writes into the installed skill folder. |
| `calibration.md`, `runs/` | Not shipped. Written per project into the installed skill folder by `/acos calibrate` and by runs. |
| `.claude/skills/acos/` | This repository's own install: a pointer to `skills/acos/`, plus its `config.yaml` and `runs/`. |
| `skills/acos/scripts/shot.mjs` | Captures a cropped PNG of a running page with headless Chrome or Edge, so a part can show what it changed instead of describing it. Reuses Codex's bundled Playwright when present and otherwise uses dependency-free CDP. `--init` runs a script before the page's first render. |
| `skills/acos/scripts/shots.mjs` | Scripted captures from a spec file, for what one `shot.mjs` command cannot reach: a script before first render, clicks, typing, key presses and drags, and several crops of one page at several widths from one browser. Dependency-free CDP. |
| `install.md` | How to drop this into a project. |

## Design choices

- **Only the user starts ACOS.** The skill never triggers itself:
  `disable-model-invocation: true` for Claude Code,
  `agents/openai.yaml` `allow_implicit_invocation: false` for Codex.
- **The GO gate is mandatory.** Only a project's own `config.yaml` can set
  it to `auto`. Presets cannot. A part already written and started with
  `/acos run` does not wait again: it prints its strategy and starts,
  and the user challenges while it works.
- **The plan suggests; the part settles.** A planner cannot know how
  many workers each part needs or which modules each takes. It fixes
  the parts and suggests the workers. The orchestrator that runs a part
  reads what it needs and what earlier parts found, re-cuts its own
  work, rewrites its manifest and says so, without asking.
- **Workers stay short.** A slice aims at about 170k tokens and is
  never planned past 200k: one agent on thirty files is a long,
  expensive run, and a precise brief makes each worker's job close to
  mechanical.
- **Limits and estimates are advisory.** Per-context token limits (orchestrator
  and worker context) shape the manifest and split big tasks into a
  plan at compose time, and a part into slices when it starts. An optional `worker_tokens_total` is the only
  aggregate worker ceiling. Compose-time reservations are conservative;
  measured actuals stay unknown until an adapter or usage observer reports them.
  Nothing checks them mid-run; `/acos calibrate` does, afterwards.
- **The user picks how a plan runs.** Before cutting, the orchestrator
  asks: one session that orchestrates workers in parallel waves, a
  fresh session per part in order, or sessions side by side on parts
  that share no file (one worktree unless a part cannot share it). The
  cut follows the answer. Every part is still a complete manifest.
- **The orchestrator reads to plan; no two workers read one file.**
  Planning an execution means opening files, and briefs written from
  the code carry the decisions. What is worth avoiding is two workers
  opening the same file: each has one worker, and what another needs
  from it arrives as a signature in its brief. A habit, not a rule.
- **A session does not start at zero.** `config.yaml` records the startup
  load — system prompt, tools, MCP servers, memory, skills — measured by
  `/acos init`. Sizing subtracts it before anything else, so the budget
  a part really has is the limit minus what the session already spent
  being itself.
- **Inline by default, for work one context should hold.** The
  orchestrator does the work. A stage is delegated when independence,
  isolation, parallelism or a budget that cannot hold the read pays for
  the round trip. Three files do not get ten subagents.
- **One more agent before one more part.** Another part costs a whole
  session's startup plus a handoff written and read; another worker
  costs its own startup on a cheaper tier, in parallel, and dies when it
  returns. Work that does not fit is sliced inside the part first.
- **Cuts are vertical.** A part carries one capability through every
  layer it touches, and every file has exactly one owner in the plan. A
  layer per part makes each part re-read what the last one read. Where
  an overlap is unavoidable it gets one owner and is stated in the cut.
- **Effort belongs to delegated stages.** The orchestrating session's
  model and reasoning effort are fixed for its whole life, so inline
  stages carry neither, and a manifest never promises step 1 at high and
  step 3 at low. A stage that needs different ones is delegated.
- **Fan-out when slices are disjoint.** Two or more groups of files that
  share nothing become one part: the orchestrator plans once and writes a
  brief per slice, a balanced-tier implementer per slice
  runs in parallel owning only its files, verify runs on the merged
  tree. A group too big for one worker is split at its thinnest seam.
  One group stays inline, unless the orchestrator's remaining
  budget cannot hold it.
- **Tier by role.** Plan, brief and handoff on the session model;
  explorers on the fast tier; implementers in a fan-out and the
  evidence worker on the balanced tier;
  review on the strong tier; verify on none. Screenshots are captured and
  looked at by the evidence worker, so pixels never enter the
  orchestrator's context, and its verdict is a check the part must pass.
- **Parts wait only for what they build on.** `after` orders a plan;
  parts it does not link form a wave and run at the same time.
- **Scope is optional and advisory.** Hints, not a sandbox.
- **Presets reference model tiers** (`fast`, `balanced`, `strong`), not
  model ids, and so do blocks and project config. `providers.yaml` maps
  a tier to a model family (`opus`, `sol`); the Codex command adds the
  generation (`gpt-6-`), so a release changes nothing and a generation
  is one line. Only the manifest names an id, written
  fresh at compose time; the log records the one that ran. A repo picks
  tier and effort per block in `config.yaml` `stages`.
- **After GO, no re-approval.** Changes in flight are drift: applied,
  written back into the manifest and recorded in the run log. The user
  is asked again only on `on_fail: ask` or a gate.
- **Calibration is a separate step.** `/acos calibrate` compares manifests
  with their run logs across runs and writes a short note the next
  compose reads. Runs stay small; learning happens between them.
- **Nothing to hand-edit.** `/acos init` derives `config.yaml` from the
  repo. Presets grow out of real runs, not templates.
- **One folder per project.** A project's ACOS files — skill, catalog,
  presets, config, calibration, runs — all sit in its skill folder
  (`.claude/skills/acos/`). Nothing lands at the repo root.
- **Installed files cite only installed paths.** `skills/acos/` is
  copied into other repositories; `SPEC.md`, `schema/` and
  `install.md` stay here. A pointer from a copied file to one of them
  names something the reader cannot open, so the copied files carry the
  shape they need inline and cite nothing outside themselves.

## Status

Version 0.1, being validated on real projects. Expect field changes.

## Validate a manifest

```
npx ajv-cli@5 validate --spec=draft2020 -s schema/acos.schema.json -d my-manifest.json
```

The lightweight estimation contract examples cover lane fit, work classes,
evidence deferral and observed usage:

```
node --test tests/estimation-contract.test.mjs
```

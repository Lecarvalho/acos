# Installing ACOS in a project

Everything ACOS needs, and everything it writes, lives in one folder: the
installed skill. Nothing lands at the repo root.

## 1. Copy the skill

Copy `skills/acos/` from this repo to:

```
<your-repo>/.claude/skills/acos/
  SKILL.md                 manual only: disable-model-invocation (Claude Code)
  agents/openai.yaml       manual only: allow_implicit_invocation: false (Codex)
  references/*.md
  scripts/shot.mjs
  catalog/providers.yaml
  catalog/blocks/*.yaml
  presets/*.yaml
  config.example.yaml
  .gitignore
```

## 2. Models

Blocks, presets and `config.yaml` never name a model id: they ask for a
tier (`fast`, `balanced`, `strong`). `catalog/providers.yaml` maps each
tier to a model family: `opus`, `sonnet`, `haiku` for Claude, `astra`,
`sol`, `luna` for Codex. Claude resolves families itself, so a release
needs no edit. Codex needs full ids, so its invoke command adds the
generation (`--model gpt-6-{{alias}}`): a new generation is one line in
upstream `providers.yaml`, re-copied. Each
manifest names the concrete id, written fresh when the run is composed.

To decide which tier and effort a block gets in this repo, add a
`stages` entry to `config.yaml` (see `config.example.yaml`). Blocks and
`providers.yaml` stay untouched.

## 3. Let the agent write project defaults

In Claude Code, run:

```
/acos init
```

The skill inspects the repo (test/lint scripts, installed provider CLIs,
catalog model tiers) and writes `config.yaml` next to `SKILL.md`. It asks only about what it
cannot read off the repo: the verify command when nothing named it, and
the session's startup load.

That startup load is the `startup` block: what a session of this project
holds before it reads a line of code — system prompt, tool schemas, MCP
servers, memory, skill descriptions — and what a fresh subagent holds.
Every estimate starts from it instead of from zero, so init asks you to
run `/context` once in a fresh session and paste the numbers; without a
paste it estimates and says so. Re-run `/acos init` after adding an MCP
server, a skill or a memory file: the number moves, and every estimate
moves with it.

`config.example.yaml` shows the shape if you prefer to write it by hand.
It names a `provider` and never a model id.

`shot` is left pointing at the copied `scripts/shot.mjs`, which captures the
cropped screenshots a part's try-it page is built from. A project whose
interface is not a web page points the key at its own capture command; one
with no visible surface removes the key, and parts simply close without
captures. The script automatically reuses Codex's bundled Playwright runtime
when it is available and falls back to its dependency-free CDP transport in
Claude or a standalone Node session. Set `ACOS_PLAYWRIGHT` to a Playwright
package directory for another bundled layout, or to `off` to force CDP.

Presets are optional. The first runs compose stages ad hoc from the
blocks. When a run's shape is worth keeping:

```
/acos save-preset <name>
```

After a few runs, in a session of its own:

```
/acos calibrate
```

reads `runs/*/manifest.yaml`, `log.yaml` and `plan.yaml` in the skill
folder, and writes `calibration.md` beside them: how this repo tends to behave (which
stages get dropped, what things cost, recurring fixes). Compose reads it.
Commit it; it is the project's memory of its own runs.

## 4. Run output

The skill's own `.gitignore` keeps `runs/` out of git; the repo's
`.gitignore` needs no change. Delete that line if you want
`/acos calibrate` to see history across machines. Either way, commit
`calibration.md`.

## 5. Use it

In Claude Code:

```
/acos add silent token refresh on 401 in the auth client
```

The skill runs only when invoked this way; the agent never starts it on its own. You will
see the manifest, reply `GO`, and the run starts. It does not stop again
unless a check fails with `on_fail: ask` or a gate is set.

If the task is bigger than the repo's session limits you get a plan
instead: `runs/<plan-id>/plan.yaml` in the skill folder, plus one manifest per part. Run each
part in its own session:

```
/acos run runs/<plan-id> 1
```

`/acos plan <task>` stops before executing anything: it proposes the cut,
writes the plan once you agree, and ends. That is the usual way to
prepare work ahead of time or attach manifests to a ticket. A task small
enough for one run gets a single manifest instead of a plan.

## Updating

Re-copy `SKILL.md`, `references/`, `scripts/`, `catalog/providers.yaml`
and `config.example.yaml`. `catalog/blocks/`, `presets/`, `config.yaml`,
`calibration.md` and `runs/` are yours once written; diff blocks and
presets against this repo when you want upstream changes.

### From the old layout

Earlier installs spread ACOS across the repo root. Move each piece into
the skill folder and drop the duplicate model ids:

| Old | New |
|-----|-----|
| `.acos.yaml` | `config.yaml`, with its `models:` map removed |
| `acos/catalog/` | `catalog/` |
| `acos/presets/` | `presets/` |
| `acos/calibration.md` | `calibration.md` |
| `runs/` | `runs/` |
| `runs/` line in the repo `.gitignore` | the skill's `.gitignore` |

Replace `catalog/providers.yaml` with this repo's. In blocks and
presets, replace `model: "{{ project.models.<tier> }}"` with
`tier: <tier>`, and in escalation entries `provider`/`model` with
`tier`. A repo that had changed a block's model or effort moves that
choice into `config.yaml` `stages`.

For installations created before per-worker lane limits were explicit,
rename `limits.worker_tokens` to `limits.worker_context_tokens`. Use
`worker_tokens_total` only when the project intentionally wants an
additional aggregate ceiling across all workers in one run.

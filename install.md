# Installing ACOS in a project

Two copies land in your repo: the skill (so your agent knows the
procedure) and the catalog (so it has blocks and presets to compose from).

## 1. Copy the skill

```
<your-repo>/.claude/skills/acos/
  SKILL.md
  references/adapters.md
  references/workflow.md
  scripts/shot.mjs
```

Copy from `skills/acos/` in this repo.

## 2. Copy the catalog and presets

```
<your-repo>/acos/
  catalog/providers.yaml
  catalog/blocks/*.yaml
  presets/*.yaml
```

Copy the whole `acos/` folder from this repo. Edit `providers.yaml` so
the `external` commands match the CLIs you actually have. Delete providers
you do not use.

## 3. Let the agent write project defaults

In Claude Code, run:

```
/acos init
```

The skill inspects the repo (test/lint scripts, installed provider CLIs,
catalog model tiers) and writes `.acos.yaml`. It asks only about what it
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

`.acos.example.yaml` in this repo shows the shape if you prefer to write
it by hand.

`shot` is left pointing at the copied `scripts/shot.mjs`, which captures the
cropped screenshots a part's try-it page is built from. A project whose
interface is not a web page points the key at its own capture command; one
with no visible surface removes the key, and parts simply close without
captures.

Presets are optional. The first runs compose stages ad hoc from the
blocks. When a run's shape is worth keeping:

```
/acos save-preset <name>
```

After a few runs, in a session of its own:

```
/acos calibrate
```

reads `runs/*/manifest.yaml`, `log.yaml` and `plan.yaml`,
and writes `acos/calibration.md`: how this repo tends to behave (which
stages get dropped, what things cost, recurring fixes). Compose reads it.
Commit it; it is the project's memory of its own runs.

## 4. Ignore run output

Add to `.gitignore`:

```
runs/
```

Keep `runs/` out of the ignore list if you want `/acos calibrate` to see
history across machines. Either way, commit `acos/calibration.md`.

## 5. Use it

In Claude Code:

```
/acos add silent token refresh on 401 in the auth client
```

or just describe the task and ask for it to be run through ACOS. You will
see the manifest, reply `GO`, and the run starts. It does not stop again
unless a check fails with `on_fail: ask` or a gate is set.

If the task is bigger than the repo's session limits you get a plan
instead: `runs/<plan-id>/plan.yaml` plus one manifest per part. Run each
part in its own session:

```
/acos run runs/<plan-id> 1
```

`/acos plan <task>` stops before executing anything: it proposes the cut,
writes the plan once you agree, and ends. That is the usual way to
prepare work ahead of time or attach manifests to a ticket. A task small
enough for one run gets a single manifest instead of a plan.

## Updating

Re-copy the skill folder. Catalog and presets are yours once copied; diff
against this repo when you want upstream changes.

# Installing ACOS in a project

Two copies land in your repo: the skill (so your agent knows the
procedure) and the catalog (so it has blocks and presets to compose from).

## 1. Copy the skill

```
<your-repo>/.claude/skills/acos/
  SKILL.md
  references/adapters.md
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
catalog model tiers) and writes `.acos.yaml`. It asks only if the verify
command is a guess. `.acos.example.yaml` in this repo shows the shape if
you prefer to write it by hand.

Presets are optional. The first runs compose stages ad hoc from the
blocks. When a run's shape is worth keeping:

```
/acos save-preset <name>
```

## 4. Ignore run output

Add to `.gitignore`:

```
runs/
```

Keep it if you want a history of manifests and logs in the repo.

## 5. Use it

In Claude Code:

```
/acos add silent token refresh on 401 in the auth client
```

or just describe the task and ask for it to be run through ACOS. You will
see the manifest, reply `GO`, and the run starts.

## Updating

Re-copy the skill folder. Catalog and presets are yours once copied; diff
against this repo when you want upstream changes.

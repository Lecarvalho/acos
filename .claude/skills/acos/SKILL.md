---
name: acos
description: Size a task against the project's session limits, compose an ACOS run manifest (or a plan of manifests, one per session), show it, wait for GO, then execute it without further interruptions and record what actually ran. Runs only when the user invokes /acos.
disable-model-invocation: true
---

# ACOS runner

This skill is defined once in the shared repo package, so both harnesses run the same
procedure. Read `skills\acos\SKILL.md` from the repository root and follow it
exactly.

That file refers to its references, scripts, catalog and presets relative to its own
directory, which is `skills\acos\` from the repository root.

This repository's own ACOS files are the exception: `config.yaml`, `calibration.md` and
`runs\` live here, in `.claude\skills\acos\`, next to this pointer, so the shipped
`skills\acos\` folder never carries one project's settings or history.

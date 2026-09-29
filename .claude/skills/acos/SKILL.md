---
name: acos
description: Compose an ACOS run manifest from the project's block catalog, show it, wait for GO, then execute it stage by stage. Use when the user invokes /acos, asks to "run this through acos", or the user asks for a non-trivial code change in this repository.
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

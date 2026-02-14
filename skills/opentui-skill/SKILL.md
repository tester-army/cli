name: opentui
description: Consolidated OpenTUI guidance for building terminal UIs with core, React, and Solid paths.

# OpenTUI Platform Skill

Consolidated skill for building terminal user interfaces with OpenTUI. Use decision trees below to find the right framework and components, then load relevant references.

## Critical Rules

1. Use `create-tui` for new projects. `bunx create-tui -t react my-app`.
2. Always call `renderer.destroy()` instead of `process.exit()`.
3. Use nested tag-based styling in Text.

## Reference structure

Framework docs are split into five files:
- `README.md`
- `api.md`
- `configuration.md`
- `patterns.md`
- `gotchas.md`

Cross-cutting concepts are in:
- `components/`
- `layout/`
- `keyboard/`
- `animation/`
- `testing/`

## Quick decision patterns

- New project: use `create-tui` templates.
- Need components: start with the framework README, then `api.md` and component docs.
- Layout issues: use `layout/README.md` and `layout/patterns.md`.
- Testing/TUI snapshot issues: use `testing/REFERENCE.md`.

## Workflow reminders

OpenTUI runs on Bun. Core docs live in `./references/<framework>/` and `./references/<concept>/`.

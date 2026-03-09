---
name: testerarmy-cli
description: Use TesterArmy CLI to validate app behavior after changes. Run targeted markdown QA tests, inspect artifacts, and report concrete pass/fail results. Trigger after product code changes or when debugging regressions.
license: MIT
metadata:
  author: TesterArmy
  tags: testerarmy, qa, cli, testing, markdown-tests, regression
---

# TesterArmy CLI

Validation workflow for repositories using `ta` / `testerarmy`.

## When to Use

- After any product code change before marking work done
- When reproducing UI/API regressions with browser-level checks
- When validating auth, onboarding, dashboard, project, team, billing, or settings flows
- When you need machine-readable QA output for CI or artifacts

## Core Commands

```bash
# Check auth/key state first (recommended)
ta status --json

# Authenticate only if needed (or set TESTERARMY_API_KEY)
ta auth

# Run a single markdown scenario (human quick check)
ta run tests/01-landing-page.md

# Run all top-level tests in directory (parallel, default 3)
ta run tests/ --json

# Override concurrency
ta run tests/ --json --parallel 5

# Inspect artifacts
ta run tests/02-quick-test-runner.md --json

# Structured output for automation
ta run tests/03-create-project.md --json --output .testerarmy/latest-run.json

# List recent local runs
ta list

# Same as list (short alias)
ta ls
```

## Standard Validation Flow

## Agent Defaults

- Agents should default to `ta run ... --json`
- Add `--output <file>` when downstream steps need to read the result
- Plain text output is fine for human-only quick local checks

1. Check auth/key status first:

```bash
ta status --json
```

If `authenticated` is `false`, run `ta auth` (or set `TESTERARMY_API_KEY`).

2. Start app under test:

```bash
pnpm dev
```

3. Point tests to target app:

```bash
export TESTERARMY_TARGET_URL="http://localhost:3000"
```

4. Run at least one relevant validation scenario, either:

- a targeted markdown test from `tests/`
- an ad hoc prompt with `ta run "..." --json`

5. For cross-cutting changes, run broader coverage:

```bash
ta run tests/ --json --parallel 3
```

6. Report exact validation command(s) and result in final update.

## Scenario Selection

- Landing/public pages: `tests/01-landing-page.md`
- Quick test runner: `tests/02-quick-test-runner.md`
- Project flows: `tests/03-create-project.md`, `tests/04-project-overview.md`, `tests/11-project-settings.md`
- Run history: `tests/05-runs-history.md`
- Team/settings/auth areas: `tests/07-settings-check.md`, `tests/08-create-team.md`, `tests/09-invite-member.md`, `tests/10-create-api-key.md`
- Billing: `tests/12-billing-checks.md`

If no existing scenario covers your change, run a focused prompt with explicit URL:

```bash
ta run "verify <changed behavior>" --url "$TESTERARMY_TARGET_URL" --json
```

Ad hoc prompts are valid for final validation, not only `tests/*.md` files.

## Test Prompt Composition Rules

- Prefer markdown tests over ad-hoc prompts when available
- Keep shared auth/setup in `TESTER.md` (CLI auto-prepends it for directory and file runs)
- Do not hardcode environment-specific URLs inside test files; use `TESTERARMY_TARGET_URL`

## Artifacts and Debugging

Each run writes to `.testerarmy/<timestamp>/`:

- `run-meta.json`: lifecycle metadata (pid, timestamps, prompt, target URL)
- `result.json`: normalized QA outcome (`PASS` / `FAILED`, issues, description)
- `debug-run.json`: full stream + tool timeline when available

Useful triage flow:

```bash
ta list
ta run tests/01-landing-page.md --json --headed --timeout 900000
```

For multiple concurrent/background runs, use `ta ls` to check which runs are still `RUNNING` and which finished with `PASS` / `FAILED`.

## Exit Codes

- `0`: all tests passed
- `1`: one or more tests failed (or run cancelled)
- `2`: runtime/CLI error

Treat non-zero as validation failure.

## Required Reporting Pattern

In final updates after code changes:

- Include the `ta run ...` command(s) used
- Include pass/fail outcome
- Prefer the `--json` command variant in agent reports
- If failed, include what failed and artifact path under `.testerarmy/`

Do not claim work is validated without a TesterArmy CLI run.

## References

| File | Description |
| --- | --- |
| [reporting-template.md][reporting-template] | Copy-paste format for final validation status updates |

[reporting-template]: references/reporting-template.md

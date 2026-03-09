# Public Bug Board

This repo uses GitHub Issues as public bug board for TesterArmy CLI ecosystem.

## Issue Types

- `bug`: CLI behavior bug or broken documented flow
- `regression`: previously working behavior now broken
- `feature`: missing capability or DX improvement

Use issue templates in `.github/ISSUE_TEMPLATE/`.

## Required Data for Actionable Triage

Always include:

1. Exact command run (`ta run ...`)
2. Target URL/environment
3. Result (`PASS` / `FAILED`) and exit code
4. Artifact path under `.testerarmy/<timestamp>/`
5. Expected vs actual behavior

Without these, triage slows down.

## Triage States

- `needs-info`: missing reproduction detail
- `confirmed`: team reproduced
- `in-progress`: fix work started
- `blocked`: waiting on dependency
- `shipped`: fixed and released

## Fast Repro Checklist

```bash
ta status --json
export TESTERARMY_TARGET_URL="http://localhost:3000"
ta run tests/ --parallel 3 --debug
ta ls
```

Attach artifact paths from failing run directory.

# Shared Test Instructions

Use `<target_url>` as app under test.

## Scope

- focus on functional regressions first
- ignore minor visual noise unless it blocks core flow

## Authentication

1. Open `<target_url>/sign-in`
2. Authenticate with valid test account for this environment
3. Continue only after dashboard/home is visible

## Reporting

- return `PASS` only if all required checks pass
- return `FAILED` with short concrete reason when any check fails

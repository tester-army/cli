---
name: testerarmy-cli
description: Use TesterArmy CLI to create, organize, and run dashboard-managed QA tests. Prefer saved tests, groups, project context, credentials, and remote runs over one-off local prompts. Trigger when defining regression coverage or adding QA flows.
license: MIT
metadata:
  author: TesterArmy
  tags: testerarmy, qa, cli, dashboard-tests, regression
---

# TesterArmy CLI

Create dashboard-managed QA coverage with `ta` / `testerarmy`.

Default to saved dashboard tests, groups, project context, credentials, and
remote runs. Use local `ta run "..."` only for quick exploration.

## When to Use

- Create persistent QA coverage for a feature or product area.
- Convert acceptance criteria into dashboard tests.
- Add or update smoke, regression, auth, billing, onboarding, or mobile flows.

## Setup

Check auth:

```bash
ta status --json
```

If needed:

```bash
ta auth
ta auth --api-key <key>
TESTERARMY_API_KEY=<key> ta status --json
ta signout
ta logout
```

Most commands that call the API accept `--api-key <key>` and `--base-url <url>`.
Use env vars or saved auth by default.

Discover scope:

```bash
ta projects list --json
ta projects get <projectId> --json
ta groups list --project <projectId> --json
ta tests list --project <projectId> --json
```

Use IDs exactly as returned.

## Project Context

Create a project:

```bash
echo '{"name":"Example","url":"https://example.com","projectType":"web"}' | ta projects create --json
echo '{"name":"Example staging"}' | ta projects update <projectId> --json
ta projects files <projectId> --json
```

Project commands: `list`, `get`, `create`, `update`, `delete`, `credentials`,
`credentials-create`, `files`.

Delete projects only when explicitly requested:

```bash
ta projects delete <projectId> --json
```

Store app knowledge:

```bash
ta memories list --project <projectId> --json
echo '{"category":"site_structure","title":"Auth route","content":"Login is at /login","importance":"high"}' | ta memories create --project <projectId> --json
ta memories delete <memoryId> --project <projectId> --json
```

Memory categories: `site_structure`, `test_insights`, `user_preferences`.

Create credentials for login or inbox flows:

```bash
ta projects credentials <projectId> --json
echo '{"kind":"login","label":"Admin","username":"admin@example.com","password":"secret"}' | ta projects credentials-create <projectId> --json
echo '{"kind":"inbox","label":"Signup inbox"}' | ta projects credentials-create <projectId> --json
```

Never print real secrets in final messages.

## Tests

Create:

```bash
echo '{"title":"Login flow","description":"User can sign in and reach the dashboard","steps":[{"title":"Navigate to /login","type":"act"},{"title":"Sign in with the saved admin credentials","type":"login","credentialId":"<credentialId>"},{"title":"Dashboard loads and shows the project list","type":"assert"}]}' | ta tests create --project <projectId> --json
```

Create in a group:

```bash
echo '{"title":"Pricing CTA","steps":[{"title":"Open /pricing","type":"act"},{"title":"Click the primary CTA","type":"act"},{"title":"Signup or dashboard flow starts","type":"assert"}]}' | ta tests create --project <projectId> --group <groupId> --json
```

Payload:

```json
{
  "title": "string, required",
  "description": "string, optional",
  "platform": "web or mobile, optional",
  "steps": [
    { "title": "User action", "type": "act" },
    { "title": "Expected result", "type": "assert" },
    { "title": "Login instruction", "type": "login", "credentialId": "uuid" },
    { "title": "Use temporary email", "type": "login", "temporaryEmail": true },
    { "title": "Upload the sample invoice PDF", "type": "files" },
    { "title": "Screenshot label", "type": "screenshot" }
  ]
}
```

Write good steps:

- Write plain-language instructions you would give to a teammate.
- Describe the user's intent, not selectors, waits, DOM structure, or component names.
- Give each step one clear job with a clear stopping point.
- Split actions and checks into separate steps.
- Use labels visible in the UI, such as `Pricing`, `New Project`, `Save`, or `Invite teammate`.
- Include business context that disambiguates the goal, such as project names, emails, plan names, or expected statuses.
- Make assertions specific enough to pass or fail confidently.
- Quote exact copy only when exact copy matters; otherwise describe the expected meaning.

Examples:

| Avoid | Write |
| --- | --- |
| `Click the button with class .nav-item:nth-child(3), wait 500ms, then assert URL contains /pricing.` | `Open the Pricing page from the header.` |
| `Log in, create a project, invite a teammate, run a test, and verify the result.` | Split into focused steps: log in, create the project, invite the teammate, run the test, then verify the result. |
| `Add the Pro plan to the cart and make sure the cart is correct.` | `Add the Pro plan to the cart.` then `Verify the cart shows the Pro plan with the correct monthly price.` |
| `Verify the dashboard looks good.` | `Verify the dashboard shows a Projects card, a Recent Runs card, and no visible error banner.` |

Before creating or updating a test, check:

- Could a teammate follow these steps without seeing the code?
- Does each step have one clear intent?
- Are actions and assertions split?
- Are user-visible labels included where useful?
- Are credentials handled by a `login` step or saved project credentials?
- Is each expected result specific enough to evaluate?

Rules:

- Cover one user journey.
- Prefer 3-10 meaningful steps.
- Use `act` for navigation, clicks, typing, and other user actions.
- Use `assert` for visible outcomes, persisted state, email delivery, or URL changes.
- Use `login` with `credentialId` or `temporaryEmail`; do not put passwords in step titles.
- Use `files` for uploading attached files.
- Use `screenshot` only for important visual checkpoints.
- Do not hide login, uploads, screenshots, or assertions inside broad action steps.
- Maximum 50 steps per test.

Inspect before changing:

```bash
ta tests list --project <projectId> --json
ta tests get <testId> --json
```

Update title, description, or steps:

```bash
echo '{"title":"Updated login smoke"}' | ta tests update <testId> --json
echo '{"steps":[{"title":"Open /login","type":"act"},{"title":"Sign in","type":"login","credentialId":"<credentialId>"},{"title":"Dashboard is visible","type":"assert"}]}' | ta tests update <testId> --json
```

Replacing `steps` requires the complete array.

Delete only when explicitly requested:

```bash
ta tests delete <testId> --json
```

## Groups

Create suites:

```bash
ta groups list --project <projectId> --json
ta groups get <groupId> --json
echo '{"projectId":"<projectId>","name":"Smoke"}' | ta groups create --json
echo '{"name":"Core smoke"}' | ta groups update <groupId> --json
ta groups add-test <groupId> <testId> --json
ta groups remove-test <groupId> <testId> --json
```

Delete non-default groups only when explicitly requested:

```bash
ta groups delete <groupId> --json
```

Common groups: `Smoke`, `Auth`, `Core journeys`, `Mobile smoke`.

## Runs

Modes:

- Default/local: fetches a saved test, then runs it on this machine.
- `--remote`: queues the saved test in TesterArmy cloud.

Local debugging:

```bash
ta tests run <testId> --url http://localhost:3000 --json
ta tests run --group <groupId> --project <projectId> --url http://localhost:3000 --parallel 3 --json
```

Remote validation:

```bash
ta tests run <testId> --remote --wait --json
ta tests run --group <groupId> --project <projectId> --remote --wait --json
ta tests run <testId> --remote --platform ios --app-id <appId> --wait --json
ta tests run <testId> --remote --platform android --app-id <appId> --wait --json
```

Defaults:

- No `--remote`: local browser execution.
- `--remote`: cloud execution.
- `--wait`: wait for remote results.
- Local-only flags such as `--headed`, `--browser`, `--timeout`, and `--system-prompt-file` are ignored with `--remote`.
- Local runs can use `--headed`, `--browser chrome|firefox|safari`, `--timeout`, `--output`, `--debug`, and `--system-prompt-file`.
- Remote runs can use `--wait-timeout`, `--wait-interval`, `--output`, `--platform web|ios|android`, and `--app-id`.
- Remote group runs can use `--environment production|staging|preview`.
- Remote single-test runs can use `--mode fast|deep`.

Runs:

```bash
ta runs list --project <projectId> --json
ta runs get <runId> --json
ta runs wait <runId> --timeout 600000 --json
ta runs cancel <runId> --json
```

## Mobile App Coverage

Upload an iOS Simulator app or Android APK before cloud runs:

```bash
ta upload-app --app-path ios/build/Build/Products/Release-iphonesimulator/MyApp.app --project <projectId> --json
ta upload-app --app-path MyApp.apk --project <projectId> --remove-after 3600 --json
ta tests run <testId> --remote --platform ios --app-id <appId> --wait --json
ta tests run <testId> --remote --platform android --app-id <appId> --wait --json
```

Supported uploads: `.app`, `.app.zip`, `.zip` for iOS Simulator apps and `.apk`
for Android. Use `--remove-after <seconds>` to auto-delete uploaded apps.

## Local Prompt

`ta run <prompt>` runs an ad hoc local browser test:

```bash
ta run "check pricing CTA" --url https://example.com --json
```

Useful flags: `--headed`, `--browser chrome|firefox|safari`, `--timeout`,
`--output`, `--debug`, and `--system-prompt-file`.

Use only to explore before creating or updating dashboard tests. Use
`ta tests create` and `ta tests run --group` for durable workflows.

## Reporting

Report:

- Project ID/name
- Test IDs and titles created or updated
- Group IDs/names touched
- Remote validation command and result, if run
- Run ID or artifact/output path, if available

Do not claim durable coverage unless `ta tests create` or `ta tests update` ran.

## References

| File | Description |
| --- | --- |
| [reporting-template.md][reporting-template] | Dashboard coverage report template |

[reporting-template]: references/reporting-template.md

---
name: testerarmy-cli
description: Use TesterArmy CLI to create, organize, schedule, and run dashboard-managed QA tests in TesterArmy cloud. Trigger when defining regression coverage, validating a flow, exploring an app for bugs, or inspecting remote test results and issues.
license: MIT
metadata:
  author: TesterArmy
  tags: testerarmy, qa, cli, dashboard-tests, regression
---

# TesterArmy CLI

Create dashboard-managed QA coverage with `ta` / `testerarmy`.

The CLI is a control plane for the TesterArmy dashboard: manage projects,
environments, credentials, and saved tests, and queue runs that execute in
TesterArmy cloud. Use a cloud-reachable preview or tunnel environment to
validate development changes.

## When to Use

- Create persistent QA coverage for a feature or product area.
- Convert acceptance criteria into dashboard tests.
- Add or update smoke, regression, auth, billing, onboarding, or mobile flows.
- Explore an area for bugs without a saved test, or triage the issues runs found.

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

`ta docs <topic>` prints the full reference for a topic: `projects`,
`memories`, `tests`, `groups`, `runs`, `issues`, `discover`, `ci`.

## Project Context

Create a project:

```bash
echo '{"name":"Example","url":"https://example.com","projectType":"web"}' | ta projects create --json
echo '{"name":"Example staging"}' | ta projects update <projectId> --json
ta projects files <projectId> --json
ta projects files-upload <projectId> --file avatar.png --description "Profile photo" --json
```

Project commands: `list`, `get`, `create`, `update`, `delete`, `environments`,
`environments-create`, `environments-delete`, `credentials`,
`credentials-create`, `files`, `files-upload`, `apps`, `apps-delete`.

Project files (max 50 MB) are inputs runs can use, such as uploads for `files`
steps. On mobile projects, photos and videos are preloaded into the device
library.

Manage saved environments (remote run targets such as Staging or QA):

```bash
ta projects environments <projectId> --json
ta projects environments-create <projectId> --name Staging --url https://staging.example.com --json
ta projects environments-delete <projectId> <environmentId> --json
```

Production and PR Preview are built-in environments and cannot be deleted.
Target a saved environment on runs with `--env <nameOrSlug>` or
`--project-environment-id <id>`.

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

Update title, description, steps, or enabled:

```bash
echo '{"title":"Updated login smoke"}' | ta tests update <testId> --json
echo '{"steps":[{"title":"Open /login","type":"act"},{"title":"Sign in","type":"login","credentialId":"<credentialId>"},{"title":"Dashboard is visible","type":"assert"}]}' | ta tests update <testId> --json
echo '{"enabled":false}' | ta tests update <testId> --json
```

Replacing `steps` requires the complete array.

Toggle a test without deleting it:

```bash
ta tests disable <testId> --json
ta tests enable <testId> --json
```

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

Run a group on a recurring schedule (web projects only). Use `--frequency`
(`every_1h`, `every_3h`, `every_6h`, `every_12h`, `daily`, `weekly`) with
`--minute`, `--hour`, and `--day-of-week`, or `--cron` for anything else:

```bash
ta groups schedule <groupId> --json
ta groups schedule-set <groupId> --frequency daily --hour 8 --timezone Europe/Warsaw --json
ta groups schedule-set <groupId> --cron "0 8 * * 1-5" --project-environment-id <environmentId> --json
ta groups schedule-delete <groupId> --json
```

A group has at most one schedule; `schedule-set` replaces it. Schedules run
every enabled test in the group against Production unless
`--project-environment-id` is set. Timezone defaults to UTC.

## Runs

`ta tests run` queues the saved test in TesterArmy cloud. Add `--wait` for
validation; without it, exit code 0 only confirms that the run was queued.

```bash
ta tests run <testId> --wait --json
ta tests run <testId> --env staging --wait --json
ta tests run --group <groupId> --project <projectId> --wait --json
ta tests run <testId> --platform ios --app-id <appId> --wait --json
ta tests run <testId> --platform android --app-id <appId> --wait --json
```

Development targets must be reachable from the cloud browser. Save a preview
or tunnel URL as an environment, then select it on the run:

```bash
ta projects environments-create <projectId> --name Development --url https://dev.example.com --json
ta tests run <testId> --env development --wait --json
```

Run options:

- `--env <nameOrSlug>` or `--project-environment-id <id>`: select a saved project environment; do not combine them.
- `--url <url>`: target URL override for group runs; do not combine it with `--env`.
- `--wait-timeout <ms>` and `--wait-interval <ms>`: control how long to wait and the initial polling interval.
- `--platform web|ios|android`, `--app-id`, and `--device-model`: select the runtime and mobile build/device.
- Group runs can use `--environment production|staging|preview` to label the run origin.
- Single-test runs can use `--mode fast|deep`.

Save a local result artifact with shell redirection:

```bash
ta tests run <testId> --env development --wait --json > result.json
```

Runs:

```bash
ta runs list --project <projectId> --json
ta runs get <runId> --json
ta runs wait <runId> --timeout 600000 --json
ta runs messages <runId> --json
ta runs telemetry <runId> --json
ta runs cancel <runId> --json
ta runs recording <runId> --output ./recordings/
```

To debug a failed run: `ta runs get` first, then `ta runs messages` for what
the agent did, `ta runs telemetry` for console and network errors, and
`ta runs recording` for the screen recording. Without `--output`, `recording`
prints a short-lived MP4 link.

Group runs share a batch ID:

```bash
ta batches get <batchId> --json
ta batches cancel <batchId> --json
ta batches rerun <batchId> --json
```

Export JUnit XML for CI reporters or TestRail. It fails until every run
finishes unless `--allow-incomplete` is set:

```bash
ta runs junit <runId> --output report.xml
ta batches junit <batchId> --output report.xml
```

## Discovery and Issues

`ta discover` queues a free-roam run: the agent explores toward a goal with no
saved test and reports bugs. A FAILED verdict means bugs were found. With
`--wait`, the command exits 1 for every outcome except a pass: bugs found
(FAILED), blocked, or cancelled. Read the run verdict in the `--json` output to
tell them apart.

```bash
ta discover --project <projectId> --goal "Explore checkout and find bugs" --wait --json
ta discover --project <projectId> --goal "Explore settings" --target-url https://staging.example.com --wait --json
ta discover --project <projectId> --goal "Explore onboarding" --platform android --wait --json
```

`--target-url` is web only. Mobile projects default to iOS and explore the
latest uploaded app; `--app-id` picks another build and needs
`--platform ios|android`. `--device-model` picks the device.

Found bugs land in issues, deduplicated across runs and tracked per
environment:

```bash
ta issues list --project <projectId> --status open --json
ta issues list --project <projectId> --environment staging --limit 20 --json
ta issues get <issueId> --project <projectId> --json
```

Statuses: `open`, `resolved`, `false_positive`. `ta issues get` lists the runs
that surfaced the issue; inspect them with `ta runs messages` or
`ta runs recording`. Turn flows worth keeping into saved tests.

## Mobile App Coverage

Upload an iOS Simulator app or Android APK before cloud runs:

```bash
ta upload-app --app-path ios/build/Build/Products/Release-iphonesimulator/MyApp.app --project <projectId> --json
ta upload-app --app-path MyApp.apk --project <projectId> --remove-after 3600 --json
ta tests run <testId> --platform ios --app-id <appId> --wait --json
ta tests run <testId> --platform android --app-id <appId> --wait --json
```

Supported uploads: `.app`, `.app.zip`, `.zip` for iOS Simulator apps and `.apk`
for Android. Use `--remove-after <seconds>` to auto-delete uploaded apps.

List or delete uploaded builds:

```bash
ta projects apps <projectId> --json
ta projects apps-delete <projectId> <appId> --json
```

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

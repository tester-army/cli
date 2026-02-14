# DESIGN_SPEC.md - TesterArmy CLI

> Local, autonomous AI QA CLI with a main orchestrator and worker agents.

## Document status

- Version: 3.0
- Last updated: 2026-02-14
- Scope: Local-first, macOS-only, Bun-first, global install
- Owner: TesterArmy CLI planning

## Executive goal

Build a local macOS CLI that runs natural-language Markdown test scenarios with a main orchestrating agent and parallel worker agents that use `agent-browser` for browser actions.

## What stays true from v1

- Local CLI only.
- Main orchestrator agent + parallel workers.
- OpenTUI interface for interactive usage.
- Markdown-only scenario authoring.
- pi-mono for LLM/provider orchestration.
- Worker reports via `report_issue` and final structured summary.
- Self-healing exists but requires human confirmation.

## Confirmed decisions

- Runtime: Bun.
- Distribution: global install.
- OS: macOS only.
- Browser execution: local only.
- Browser isolation: logical session isolation.
- UI tech: OpenTUI + SolidJS.
- Self-healing default mode: suggest-and-confirm.
- Self-healing confidence threshold target: 70%.
- Default parallelism: configurable, start with 4 unless configured.

## Open questions that still need your input

- Default worker policy: fixed count or CPU-adaptive.
- Issue severity model: enum labels or numeric scale.
- Streaming vs summary-only default in machine output.
- Whether semantic fallback is always enabled or behind a confidence gate.
- Desired test coverage gate for v1 final readiness.

## Why this is not done by `agent-browser` alone

`agent-browser` provides browser-level tooling.
`TesterArmy` provides coordination, orchestration, reporting, and policy enforcement.

### `agent-browser` responsibilities (tool layer)

- Open pages, capture snapshots with refs, execute interactions, navigate and wait.
- Run assertions/inspection helpers.
- Screenshot/pdf/visual capture.
- Manage browser/session primitives.

### `TesterArmy` responsibilities (orchestration layer)

- Parse scenario files into executable plans.
- Create and schedule worker runs.
- Handle retries, worker failures, timeouts, and escalation.
- Maintain event timeline and correlation IDs.
- Normalize `agent-browser` output into stable app contracts.
- Aggregate multi-worker results.
- Enforce self-healing policy and human confirmation controls.
- Emit CLI/TUI and machine-readable summaries.

## Target architecture

### Logical diagram

```text
┌────────────────────────────────────────────────────────────────┐
│                      CLI entrypoint                             │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                      Interactive path (OpenTUI)                  │
├──────────────────────────────────────────────────────────────────┤
│                    or Non-interactive path                       │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                     Command Router                               │
│ run, generate, config, version, completion                       │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                 Main Orchestrator (pi-mono agent)                │
├──────────────────────────────────────────────────────────────────┤
│ Scenario planner, policy engine, worker scheduler                  │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                    Worker Supervisor / Queue                     │
├──────────────────────────────────────────────────────────────────┤
│ Spawns worker processes/handlers, assigns jobs, tracks lifecycle    │
└───────────────┬────────────────────────────────────────────────┘
                │
      ┌─────────┴─────────┐
      │                   │
┌─────▼───────┐     ┌─────▼───────┐
│ Worker 1    │ ... │ Worker N    │
│ tool loop   │     │ tool loop   │
│+ sessions   │     │+ sessions   │
└─────┬───────┘     └─────┬───────┘
      │                     │
      └─────────┬───────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│             `agent-browser` command facade per worker              │
└──────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                    Aggregator + Reporter                        │
│ Issue de-dup, summaries, output formatters, persistence          │
└──────────────────────────────────────────────────────────────────┘
```

## Feature set (v1)

### Core feature 1: Scenario execution from markdown

- Input is one `.md` file or directory of `.md` files.
- Execute scenarios in parallel by worker shards.
- Provide final summary per scenario and global run summary.

### Core feature 2: Parallel workers

- Run multiple worker streams at configurable concurrency.
- Workers can share provider and policy config.
- Fail-fast and complete-all are supported run modes.

### Core feature 3: Browser automation

- Open and interact with pages through tool calls.
- Re-snapshot after navigation and major DOM mutations.
- Capture evidence for each failed step.

### Core feature 4: Worker bug reporting

- Worker must expose `report_issue` tool.
- Final report contains structured defects and run-level summary.

### Core feature 5: Interactive TUI + machine mode

- Interactive command palette for human flow.
- Non-interactive JSON/NDJSON output for agent integration.

### Core feature 6: Maintenance helpers

- Scenario parsing and generation from directories.
- Result history storage.

## Scenario format (plain markdown)

### Required scenario shape

- Title block and one or more `##` test sections.
- Step lines in imperative form.
- Assertion verbs map directly to browser helper wrappers.

### Example

```markdown
# Login Flow Tests

## Test 1: Successful login
- Open https://example.test/login
- Type "alice@example.com" into email field
- Type "hunter2" into password field
- Click "Login" button
- Assert URL contains "/dashboard"
- Assert text "Welcome" is visible
```

### Parser expectations

- Each top-level test block maps to one executable unit.
- Whitespace-only lines are ignored.
- Unsupported commands are surfaced as parse warnings.
- Unknown assertions can be stored as raw text for future support if not fatal.

## CLI contract

### User commands

- `tester-army` starts interactive TUI.
- `tester-army run <path>` runs one file or directory.
- `tester-army run <path> --parallel 5` sets worker count.
- `tester-army run <path> --json` enables JSON output.
- `tester-army run <path> --jsonl` enables newline-delimited output.
- `tester-army generate <dir>` scans and generates scenario seeds.
- `tester-army config` prints and edits runtime/provider config.

### Non-interactive output contract

- `--json` returns a single final response object.
- `--jsonl` streams events with incremental updates.
- Exit codes:
- `0` success with no failing assertions.
- `1` run finished with failures.
- `2` config or input validation failure.
- `3` runtime/tooling failure.

## Worker and orchestrator contracts

### Run message object

```json
{
  "runId": "uuid",
  "scenarioId": "string",
  "workerId": "string",
  "stepIndex": 0,
  "attempt": 1,
  "event": "step.start|step.complete|issue|summary|error|timeout|retry",
  "timestamp": "2026-02-14T12:00:00Z",
  "payload": {}
}
```

### Worker summary object

```json
{
  "workerId": "string",
  "scenario": "string",
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "timeMs": 12000,
  "issues": [],
  "safetyNotes": ["..."],
  "status": "passed|failed|cancelled"
}
```

### `report_issue` tool schema

```json
{
  "type": "report_issue",
  "input": {
    "title": "string",
    "severity": "blocker|high|medium|low",
    "area": "string",
    "expected": "string",
    "actual": "string",
    "steps": ["string"],
    "evidence": {
      "screenshot": "path-or-url",
      "snapshotRef": "@e1",
      "agentBrowserLogs": "path",
      "url": "string",
      "title": "string"
    },
    "confidence": 0.0
  }
}
```

### Final run aggregate object

```json
{
  "runId": "uuid",
  "startedAt": "timestamp",
  "endedAt": "timestamp",
  "status": "passed|partial|failed|error",
  "scenariosTotal": 0,
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "issues": [],
  "workerSummaries": [],
  "timing": {
    "wallClockMs": 0,
    "queuedMs": 0,
    "executionMs": 0,
    "overheadMs": 0
  }
}
```

## Browser orchestration strategy

### Session policy

- One logical `agent-browser` session per worker by default.
- Session name format: `testerarmy-{runId}-{workerId}`.
- Sessions are always torn down on completion, timeout, or fatal errors.

### Worker lifecycle

- Spawn.
- Initialize provider + tools.
- Open first scenario context.
- Execute steps in order.
- Emit step events and call report tools as needed.
- Produce final summary.
- Teardown and persist artifacts.

### Error handling

- Timeout handling at step-level and scenario-level.
- Retry transient failures for network/element-not-ready with capped attempts.
- Retry limit and backoff are policy-driven.
- No blind self-healing application without user confirmation.

### Self-healing flow

- Detect mismatch from missing refs or interaction failure.
- Propose a healed selector strategy.
- Record suggested patch in issue log with confidence score.
- Wait for user confirmation in interactive mode.
- If auto mode is disabled, skip and continue depending on policy.

### Concurrency policy

- Parallelism can be set per run.
- Main orchestration queue supports backpressure.
- At capacity, new jobs remain queued with order preserved.
- Fail-fast mode cancels queued and running jobs when threshold hit.

## Tool integration contract for pi-mono

- Use pi-mono as the agent runtime and provider abstraction.
- Configure providers through one canonical file in user config.
- Keep tool declarations in explicit list:
- `open`
- `snapshot`
- `click`
- `fill`
- `type`
- `press`
- `select`
- `check`
- `wait`
- `get_text`
- `get_url`
- `get_title`
- `screenshot`
- `report_issue`
- `assert_*`

## OpenTUI integration details

- Main layout contains:
- Home / session selector.
- Message timeline and worker status strip.
- Command palette via slash entry.
- Inline status panel with pass/fail counts.
- Right panel with latest issue evidence.

- TUI commands:
- `/run` starts execution.
- `/generate` scaffolds scenarios.
- `/config` edits runtime/provider settings.
- `/quit` exits cleanly and destroys renderer.

## Configuration design

### Config path

`~/.config/testerarmy/testerarmy.json`

### Fields

- `runtime`: bun flags and output defaults.
- `providers`: configured LLM providers and model list.
- `worker`: concurrency, timeout, failure policy.
- `browser`: type, headless, viewport, traces.
- `selfHealing`: mode, threshold, allowAutoFallback.
- `output`: verbose, json modes, artifact path.

### Example config

```jsonc
{
  "runtime": {
    "platform": "darwin",
    "bun": true,
    "defaultWorkers": 4,
    "defaultJson": false
  },
  "providers": {
    "primary": "openai",
    "enabled": ["openai", "anthropic", "google", "bedrock", "azure", "openrouter"],
    "defaults": {
      "openai": "gpt-5-mini",
      "anthropic": "claude-3.7",
      "google": "gemini-2.5"
    }
  },
  "worker": {
    "maxWorkers": 6,
    "timeoutMs": 120000,
    "stepTimeoutMs": 15000,
    "retryAttempts": 2,
    "retryBackoffMs": 500,
    "failurePolicy": "continue-all",
    "screenshotPolicy": "on-failure"
  },
  "selfHealing": {
    "enabled": true,
    "mode": "suggest-and-confirm",
    "confidence": 0.7
  },
  "browser": {
    "type": "chromium",
    "headless": true,
    "slowMoMs": 100,
    "waitForNetworkIdle": true
  },
  "output": {
    "machineModeDefault": "jsonl",
    "artifactsDir": "~/.local/share/testerarmy/results",
    "maxLogRetentionDays": 30
  }
}
```

## Storage and artifacts

- Config: `~/.config/testerarmy/testerarmy.json`.
- Results: `~/.local/share/testerarmy/results`.
- Per-run folder name: `run-{runId}`.
- Artifacts store:
- console logs,
- event streams,
- screenshot set,
- summarized report.

## Security and safety

- API keys are never written to report artifacts.
- Raw page DOM can be redacted optionally.
- Sensitive screenshots can be disabled by policy.
- Output should avoid printing secrets.

## Performance budgets

- Parse and validate scenario directory under 500 files in under 2 seconds target.
- Worker startup under 1.5 seconds for the first run local browser session.
- Typical no-op step execution should be instrumented to track step latency.

## Test plan (v1)

### Unit and parser tests

- Parse valid and invalid markdown.
- Command mapping validation.
- Tool mapping and argument normalization.

### Integration tests

- Orchestrator job queue and concurrency controls.
- Worker summary aggregation.
- Failure policies and retry logic.
- Mocked `agent-browser` contract tests.

### End-to-end tests

- Run one happy path scenario.
- Run flaky element path with expected retry/self-heal proposal.
- Run fail-fast and complete-all behavior.
- Ensure final `--json` and `--jsonl` schema integrity.

## Implementation phases (expanded)

### Phase 1: Foundation

- Bun project bootstrap.
- Strict TypeScript config.
- CLI entrypoints and shell completions.
- Config loader with defaults and schema.
- Log and exit-code contract.

### Phase 2: Core domain models

- Scenario parser and AST.
- Run, step, event, issue, summary schemas.
- Validation layer.
- In-memory state machine for worker and orchestrator.

### Phase 3: Agent-browser facade

- Command builder and output parser.
- Session lifecycle helpers.
- Screenshot/error evidence capture.
- Mock adapter for tests.

### Phase 4: pi-mono integration and tool runtime

- Tool registry and tool call handlers.
- Provider selection flow from config.
- Orchestrator system prompt and worker instructions.

### Phase 5: Worker runtime

- Worker state machine.
- Step execution and assertion execution.
- `report_issue` tool and final summary emission.

### Phase 6: Orchestration and queueing

- Queue implementation with concurrency cap.
- Failure policy and retry controller.
- Event emitter to TUI and machine outputs.

### Phase 7: OpenTUI shell

- Route-like views: home, run, session, history.
- Command palette and navigation.
- Worker run dashboard with issue drill-down.

### Phase 8: CLI modes and integrations

- Non-interactive streaming.
- Directory run and shard strategy.
- Generate mode and scenario boilerplates.

### Phase 9: Release hardening

- Artifact retention, logs, and retention policy.
- Error handling and graceful teardown.
- README and installation guide.
- Final acceptance pass.

## Acceptance criteria (must-have)

- Executes markdown scenarios end-to-end from file input.
- Runs workers in parallel and returns aggregated results.
- Emits structured worker and run summaries.
- `report_issue` tool is used for actionable defects.
- Interactive TUI runs without blocking and exits via proper cleanup.
- Non-interactive machine mode outputs valid JSON or NDJSON.

## Risks and mitigation

- Dependency volatility in external packages: pin versions and add adapter interfaces.
- Agent loop nondeterminism: deterministic prompt templates and strict schemas.
- Browser flakiness: retries plus evidence capture and bounded timeouts.
- Over-reporting bugs: severity and confidence gates.

## Source references used while planning

- `https://github.com/badlogic/pi-mono`
- `https://github.com/vercel-labs/agent-browser`
- `https://raw.githubusercontent.com/vercel-labs/agent-browser/main/skills/agent-browser/SKILL.md`
- `https://skills.sh/msmps/opentui-skill/opentui`

*Document version: 3.0*
*Updated: 2026-02-14*
*Stack: OpenTUI + pi-mono + agent-browser*

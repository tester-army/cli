# DESIGN_SPEC.md - TesterArmy CLI

> Autonomous AI QA Testing CLI

## Overview

TesterArmy CLI is an autonomous AI-powered QA testing agent specialized in software testing. It executes E2E tests from natural language prompts with deep testing expertise including assertions, DOM traversal, network monitoring, and comprehensive error diagnosis.

**Key Characteristics:**
- Testing-first agent with specialized testing knowledge
- Parallel browser execution for fast test suite runs
- Self-healing capability that adapts to UI changes
- Isolated browser sessions for each test
- Natural language test authoring

**Scenario Management:**
The main agent not only executes tests but also **generates and maintains test scenarios** as the codebase evolves. This includes:
- **Auto-generation:** Scan project files and generate relevant test scenarios
- **Maintenance:** Detect UI changes and update test scenarios accordingly
- **Refactoring:** Adapt test scenarios when application code changes
- **Coverage analysis:** Identify untested areas and suggest new scenarios

**Note:** PR integration and automated test execution on pull requests is handled by TesterArmy Web. This CLI focuses on local test development and execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TesterArmy CLI (OpenTui + SolidJS)          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Provider Layer                                          │   │
│  │  - SDKProvider (agent communication)                    │   │
│  │  - SyncProvider (server sync)                          │   │
│  │  - ThemeProvider (dark/light mode)                     │   │
│  │  - LocalProvider (config, model)                       │   │
│  │  - KeybindProvider (keyboard shortcuts)                │   │
│  │  - DialogProvider (modal dialogs)                      │   │
│  │  - CommandProvider (slash commands)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Routes Layer                                            │   │
│  │  - Home (new test sessions)                            │   │
│  │  - Session (test execution)                            │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Pi Library Layer (pi-mono)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Provider Manager                                        │   │
│  │  - 15+ providers (OpenAI, Anthropic, Google, etc.)      │   │
│  │  - API key & OAuth authentication                       │   │
│  │  - Custom providers via models.json                     │   │
│  │  - Model switching mid-session                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Agent Loop                                              │   │
│  │  - Completion with tools integration                    │   │
│  │  - Extension system (TypeScript modules)               │   │
│  │  - Skills (capability packages)                        │   │
│  │  - Prompt templates (reusable Markdown prompts)        │   │
│  │  - Context management (compaction, summarization)      │   │
│  │  - Tree-structured session history                     │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     agent-browser                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Rust CLI + Node.js Daemon (Playwright-based)          │   │
│  │  - Client-daemon architecture for performance           │   │
│  │  - 50+ commands (navigation, forms, screenshots)       │   │
│  │  - Ref-based interaction (@e1, @e2) - deterministic    │   │
│  │  - Multiple isolated sessions (separate auth)          │   │
│  │  - Compact output (~200-400 tokens vs ~3000-5000 DOM)   │   │
│  │  - Cross-platform (macOS, Linux, Windows ARM64/x64)    │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Worker Layer                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │Session 1│ │Session 2│ │Session 3│ │Session N│             │
│  │(browser)│ │(browser)│ │(browser)│ │(browser)│             │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
│     ↕            ↕            ↕            ↕                  │
│  agent-browser instances (isolated sessions)                  │
└─────────────────────────────────────────────────────────────────┘
```

## OpenTui Integration (SolidJS)

TesterArmy CLI uses **OpenTui with SolidJS** bindings for the terminal user interface. This provides reactive UI with fine-grained updates and minimal overhead.

### Framework Choice

OpenCode (which also uses OpenTui) confirmed that **SolidJS** is the recommended binding for complex TUI applications:
- `@opentui/solid` - SolidJS bindings
- Fine-grained reactivity (no Virtual DOM)
- Efficient updates (only changed parts re-render)
- Smaller bundle size than React

### Installation

```bash
bun add @opentui/solid @opentui/core solid-js
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "skipLibCheck": true
  }
}
```

### App Entry Point Pattern (from OpenCode)

```typescript
import { render } from "@opentui/solid"
import { ErrorBoundary, createSignal, batch } from "solid-js"
import { RouteProvider, useRoute } from "@tui/context/route"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { LocalProvider, useLocal } from "@tui/context/local"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { ToastProvider, useToast } from "./ui/toast"
import { Home } from "./routes/home"
import { Session } from "./routes/session"

export function tui(args: Args) {
  return new Promise<void>(async (resolve) => {
    render(
      () => {
        return (
          <ErrorBoundary fallback={(error) => <ErrorComponent error={error} />}>
            <SDKProvider url={args.url} directory={args.directory}>
              <SyncProvider>
                <ThemeProvider mode="dark">
                  <LocalProvider>
                    <KeybindProvider>
                      <DialogProvider>
                        <CommandProvider>
                          <ToastProvider>
                            <RouteProvider>
                              <App />
                            </RouteProvider>
                          </ToastProvider>
                        </CommandProvider>
                      </DialogProvider>
                    </KeybindProvider>
                  </LocalProvider>
                </ThemeProvider>
              </SyncProvider>
            </SDKProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        exitOnCtrlC: false,
      },
    )
  })
}

function App() {
  const route = useRoute()
  const sync = useSync()
  const local = useLocal()
  const dialog = useDialog()
  const command = useCommandDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  // Register slash commands
  command.register(() => [
    {
      title: "New test session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      slash: { name: "new" },
      onSelect: () => {
        route.navigate({ type: "home" })
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      category: "Agent",
      slash: { name: "models" },
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    // More commands...
  ])

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
    </box>
  )
}
```

### Core SolidJS Patterns

#### Signals (local state)
```typescript
const [sidebar, setSidebar] = createSignal("auto")
const [showThinking, setShowThinking] = createSignal(true)
```

#### Memos (derived state)
```typescript
const contentWidth = createMemo(() => dimensions().width - sidebarWidth())
const sidebarVisible = createMemo(() => sidebar() === "auto" && wide())
```

#### Effects (side effects)
```typescript
createEffect(() => {
  sync.session.sync(route.sessionID)
  toBottom()
})
```

#### Context (shared state)
```typescript
const context = createContext<SessionContext>()

function Session() {
  return (
    <context.Provider value={{ width, sessionID, conceal, showThinking }}>
      {/* children */}
    </context.Provider>
  )
}

function useSessionContext() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext required")
  return ctx
}
```

### UI Components Pattern (from OpenCode)

#### Message Component (User Message)
```typescript
function UserMessage(props: { message: UserMessage; parts: Part[]; index: number }) {
  const ctx = useSessionContext()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const color = createMemo(() => getAgentColor(props.message.agent))

  return (
    <box
      id={props.message.id}
      border={["left"]}
      borderColor={color()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.text}>{textContent()}</text>
        <Show when={ctx.showTimestamps()}>
          <text fg={theme.textMuted}>{formatTimestamp(props.message.time.created)}</text>
        </Show>
      </box>
    </box>
  )
}
```

#### Assistant Message with Parts
```typescript
function AssistantMessage(props: { message: AssistantMessage; parts: Part[] }) {
  const { theme } = useTheme()
  const duration = createMemo(() => calculateDuration(props.message))

  return (
    <>
      <For each={props.parts}>
        {(part) => (
          <Switch>
            <Match when={part.type === "text"}>
              <TextPart content={part.text} />
            </Match>
            <Match when={part.type === "tool"}>
              <ToolPart tool={part.tool} state={part.state} />
            </Match>
            <Match when={part.type === "reasoning"}>
              <ReasoningPart text={part.text} />
            </Match>
          </Switch>
        )}
      </For>
      <box paddingLeft={3}>
        <text fg={theme.textMuted}>
          {props.message.modelID} · {duration()}
        </text>
      </box>
    </>
  )
}
```

### Scrollable Message List (from OpenCode)
```typescript
const scrollAcceleration = createMemo(() => {
  return new CustomSpeedScroll(3)
})

return (
  <scrollbox
    ref={(r) => (scroll = r)}
    stickyScroll={true}
    stickyStart="bottom"
    flexGrow={1}
    scrollAcceleration={scrollAcceleration()}
  >
    <For each={messages()}>
      {(message) => (
        <Switch>
          <Match when={message.role === "user"}>
            <UserMessage message={message} parts={parts[message.id]} />
          </Match>
          <Match when={message.role === "assistant"}>
            <AssistantMessage message={message} parts={parts[message.id]} />
          </Match>
        </Switch>
      )}
    </For>
  </scrollbox>
)
```

### Dialog System (from OpenCode)
```typescript
function DialogModel() {
  const dialog = useDialog()
  const local = useLocal()
  const models = createMemo(() => listAvailableModels())

  return (
    <box width={60} height={20} border={true} backgroundColor={theme.background}>
      <list items={models()} onSelect={(model) => {
        local.model.set(model)
        dialog.clear()
      }} />
    </box>
  )
}

// Trigger dialog
dialog.replace(() => <DialogModel />)
```

### Keyboard Shortcuts (from OpenCode)
```typescript
useKeyboard((evt) => {
  if (evt.name === "escape") {
    renderer.clearSelection()
    evt.preventDefault()
    return
  }
  if (evt.ctrl && evt.name === "c") {
    Selection.copy(renderer, toast)
    evt.preventDefault()
    return
  }
})
```

### Toast Notifications
```typescript
toast.show({
  message: "Test completed successfully",
  variant: "success", // info, warning, error
  duration: 3000,
})
```

## Key Features

- **Testing-Focused Agent:** Specialized in software testing with deep expertise in assertions, DOM traversal, and error diagnosis
- **Parallel Browser Execution:** Launch multiple isolated browser sessions simultaneously for fast test suite execution
- **Natural Language Testing:** Write tests in plain English
- **Self-Healing:** Adapts to DOM changes automatically
- **Ref-Based Interaction:** Compact AI-friendly output using accessibility tree refs
- **Multi-Provider:** OpenAI, Anthropic, Google, and more

**Note:** PR integration and automated test execution on pull requests is handled by TesterArmy Web.

## Provider Support (from Pi)

| Provider | Models | Env Variable |
|----------|--------|--------------|
| OpenAI | GPT-4o, GPT-5.3-Codex | OPENAI_API_KEY |
| Anthropic | Claude Sonnet 4.5, Claude Opus | ANTHROPIC_API_KEY |
| Google | Gemini 2.5 Pro | GOOGLE_API_KEY |
| OpenCode | Kimi K2.5, Kimi K2-Thinker | OPENCODE_API_KEY |
| Azure | GPT-4o (Azure) | AZURE_OPENAI_API_KEY |
| Bedrock | Claude, Titan | AWS Credentials |
| Mistral | Mixtral, Codestral | MISTRAL_API_KEY |
| Groq | Llama, Mixtral | GROQ_API_KEY |
| Cerebras | Llama | CEREBRAS_API_KEY |
| xAI | Grok | XAI_API_KEY |
| Hugging Face | Various | HF_TOKEN |
| Ollama | Local models | (local) |

## agent-browser Features

**Key features:**
- Compact text output - Uses ~200-400 tokens vs ~3000-5000 for full DOM
- Ref-based - Accessibility tree with refs (@e1, @e2)
- Fast - Rust CLI with Node.js daemon (Playwright under the hood)
- 50+ commands - Navigation, forms, screenshots, network, storage
- Sessions - Multiple isolated browser instances
- Cross-platform - macOS, Linux, Windows

**Works with:**
- Claude Code, Cursor, GitHub Copilot, OpenAI Codex, Google Gemini, opencode, any agent

## Example Workflow

```bash
# Open URL
agent-browser open https://example.com

# Get snapshot (returns refs)
agent-browser snapshot -i
# Output:
# - heading "Login Page" [ref=e1]
# - input "Email" [ref=e2]
# - input "Password" [ref=e3]
# - button "Sign In" [ref=e4]

# Interact using refs
agent-browser type @e2 test@example.com
agent-browser type @e3 password123
agent-browser click @e4

# Screenshot
agent-browser screenshot ./results/login-success.png

# Multiple sessions
agent-browser session create login-test
agent-browser session use login-test
agent-browser open https://example.com
agent-browser close
```

## CLI Commands

```bash
# Interactive mode
tester-army - Interactive TUI mode (OpenTui + SolidJS)

# Run tests
tester-army run <scenario.md> - Run scenario file
tester-army run ./tests/ - Run directory
tester-army run --parallel 5 - Parallel execution

# Generate tests
tester-army generate ./src/ - Scan project, generate scenarios

# Reports
tester-army report - Show test results
tester-army report --format html - HTML report

# Configuration
tester-army config - Show current config
tester-army config set provider openai - Set provider
```

## Configuration

```json
// ~/.config/testerarmy/testerarmy.json

{
  "primary_provider": "openai",
  "model": "gpt-5.3-codex",
  "providers": {
    "openai": {
      "api_key": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-5.3-codex"]
    },
    "opencode": {
      "api_key": "${OPENCODE_API_KEY}",
      "models": ["kimi-k2.5", "kimi-k2-thinker"]
    }
  },
  "worker": {
    "parallel": 5,
    "timeout": 60000
  },
  "browser": {
    "type": "chromium",
    "headless": true
  }
}
```

**Config Location:**
- **Linux/macOS:** `~/.config/testerarmy/testerarmy.json`
- **Windows:** `%APPDATA%\testerarmy\testerarmy.json`

**Environment Variables:**
```bash
export TESTERARMY_CONFIG_DIR=~/.config/testerarmy
```

## Scenario Format

```markdown
# Login Flow Tests

## Test 1: Successful Login
- Open https://example.com/login
- Wait for page to load
- Type "test@example.com" into email field
- Type "password123" into password field
- Click "Login" button
- Wait for URL to contain "/dashboard"
- Assert page title contains "Dashboard"

## Test 2: Invalid Login
- Open https://example.com/login
- Type "invalid@example.com" into email field
- Type "wrongpassword" into password field
- Click "Login" button
- Wait for error message to appear
- Assert error message contains "Invalid credentials"
- Take screenshot: ./results/invalid-login.png
```

## Implementation Phases

### Phase 1: Foundation (1-2 days)

**Goal:** Set up the project skeleton and tooling

**Deliverables:**
- Working TypeScript project with SolidJS
- All dependencies installed and configured
- Build pipeline working (dev, build, lint)
- Configuration file at correct location

**Details:**
- Initialize project with `bun init` or `npm init`
- Set up TypeScript with strict mode, DOM types
- Configure ESLint with SolidJS recommended rules
- Install: `@opentui/solid`, `@opentui/core`, `solid-js`, Pi packages
- Create `~/.config/testerarmy/testerarmy.json` with default values
- Set up package.json scripts: `dev`, `build`, `lint`, `typecheck`
- Verify agent-browser CLI is installed and working (`agent-browser --version`)

**Success Criteria:**
- `bun dev` starts development server
- `bun build` produces production bundle
- `bun lint` passes without errors
- Config file created at startup if missing

---

### Phase 2: Provider Integration (2-3 days)

**Goal:** Connect to LLM providers using Pi's provider manager

**Deliverables:**
- Working provider configuration system
- API key and OAuth authentication
- Provider switching UI

**Details:**
- Integrate Pi's ProviderManager from `@mariozechner/pi-coding-agent/providers`
- Create provider configuration UI (dropdown to select provider)
- Implement API key input (masked password field)
- Support environment variable fallback (`OPENAI_API_KEY`, etc.)
- Add provider model listing and selection
- Implement provider health check (test API connection)
- Store credentials securely (user's config file, not committed)
- Add custom provider support via extended models.json

**Success Criteria:**
- User can add/configure providers via UI
- Provider connection can be tested
- Model can be switched mid-session
- All 15+ Pi providers are supported

---

### Phase 3: Core UI Framework (3-4 days)

**Goal:** Build the application shell with providers and routing

**Deliverables:**
- Root App component with all providers nested
- Working route navigation (Home ↔ Session)
- Command palette with slash commands
- Keyboard shortcuts system

**Details:**
- Create App component following OpenCode patterns
- Nest providers: SDKProvider → SyncProvider → ThemeProvider → LocalProvider → KeybindProvider → DialogProvider → CommandProvider
- Implement route state (useRoute, useRouteData)
- Create Home route (new session screen)
- Create Session route (test execution screen)
- Build CommandPalette component with slash commands
- Register commands: `/new`, `/run`, `/generate`, `/report`, `/config`
- Implement global keyboard shortcuts: Ctrl+C (copy), Esc (cancel), Tab (autocomplete)
- Add Toast notification system (info, success, warning, error)
- Implement error boundary with recovery options

**Success Criteria:**
- App renders without errors
- Navigation between Home and Session works
- Command palette opens with `/` and shows available commands
- Keyboard shortcuts respond correctly
- Toast notifications appear for actions

---

### Phase 4: agent-browser Integration (2-3 days)

**Goal:** Connect browser automation via agent-browser CLI

**Deliverables:**
- Working Browser class wrapping agent-browser commands
- Session management for isolated browser instances
- Ref parsing and element interaction

**Details:**
- Create Browser class with methods: open, snapshot, click, type, screenshot, close
- Implement session management: createSession, useSession, closeSession
- Parse agent-browser snapshot output into structured data
- Convert refs (@e1, @e2) to element identifiers
- Implement screenshot capture and storage
- Add error handling for browser failures
- Implement retry logic for flaky commands
- Add timeout handling for long-running operations
- Support multiple concurrent browser sessions (one per worker)

**Success Criteria:**
- Browser can open URLs and capture snapshots
- Refs can be used to interact with elements (click, type)
- Screenshots are captured on demand
- Multiple isolated sessions can run concurrently
- Errors are handled gracefully with meaningful messages

---

### Phase 5: Agent Loop (3-4 days)

**Goal:** Implement AI agent that interprets test scenarios and executes browser actions

**Deliverables:**
- Working agent loop that processes test steps
- Browser tools integration (from Phase 4)
- Assertion tools for test verification
- Result collection and aggregation

**Details:**
- Integrate Pi's agent loop (createAgent from `@mariozechner/pi-coding-agent/core`)
- Create custom tools for test execution:
  - `browser_open(url)` - Navigate to URL
  - `browser_snapshot()` - Get current page state
  - `browser_click(ref)` - Click element by ref
  - `browser_type(ref, text)` - Type text into element
  - `browser_screenshot(path)` - Capture screenshot
  - `browser_close()` - Close browser session
  - `assert_text(ref, expected)` - Verify text content
  - `assert_url(expected)` - Verify current URL
  - `assert_title(expected)` - Verify page title
- Implement step-by-step test execution
- Collect pass/fail status for each assertion
- Capture screenshots on failure
- Generate structured test results

**Success Criteria:**
- Agent can parse natural language test steps
- Each step triggers appropriate browser action
- Assertions verify expected behavior
- Results show pass/fail for each step
- Screenshots captured on failures

---

### Phase 6: Chat Interface (3-4 days)

**Goal:** Build the test execution UI with messages and progress

**Deliverables:**
- Message components (UserMessage, AssistantMessage, TestResult)
- Scrollable message list with sticky scroll
- Test progress indicators
- Timeline navigation

**Details:**
- Create TestResultMessage component displaying:
  - Test name and description
  - Step-by-step execution progress
  - Pass/fail status for each assertion
  - Screenshot thumbnails (expandable)
  - Error messages on failure
- Implement scrollable message list:
  - Virtual scrolling for large test suites
  - Sticky scroll (auto-scroll to new messages)
  - Scroll acceleration and momentum
- Add progress indicators:
  - Spinner during execution
  - Progress bar for multi-step tests
  - Elapsed time counter
- Implement timeline navigation:
  - Jump to specific test/step
  - Filter by status (all, passed, failed)
- Create test branch/fork functionality for variations
- Add export transcript option (Markdown format)

**Success Criteria:**
- Messages display in a scrollable list
- New messages auto-scroll into view
- Progress indicators show execution status
- Clicking on test jumps to that test in the list
- Failed tests show error details and screenshots

---

### Phase 7: Worker Manager (2-3 days)

**Goal:** Implement parallel test execution with worker processes

**Deliverables:**
- Worker process spawning and management
- Parallel execution with configurable concurrency
- Result aggregation from all workers
- Timeout and failure handling

**Details:**
- Create worker entry point (workers/index.js)
- Implement WorkerManager class:
  - Spawn worker processes using `child_process.spawn`
  - Distribute tests across workers (round-robin or priority-based)
  - Track worker status (running, completed, failed)
  - Implement graceful shutdown (Ctrl+C handling)
- Configure parallel execution:
  - Default: 5 concurrent workers
  - Configurable via `--parallel` flag or config file
  - Resource-aware scaling (reduce workers on memory warning)
- Implement result aggregation:
  - Collect results from all workers
  - Generate unified report with summary
  - Calculate pass rate and total execution time
- Add timeout handling:
  - Per-test timeout (configurable, default 60s)
  - Per-worker timeout (restart stalled workers)
  - Global timeout (abort all on hang)

**Success Criteria:**
- Tests can run in parallel (5+ concurrent)
- Each worker gets its own browser session
- Results are aggregated into a single report
- Timeouts abort stalled tests
- Ctrl+C gracefully shuts down all workers

---

### Phase 8: Scenarios & Reports (2-3 days)

**Goal:** Add scenario parsing and report generation

**Deliverables:**
- Markdown scenario parser
- Report generation (Markdown, JSON, HTML)
- Result storage and history

**Details:**
- Create scenario parser:
  - Parse Markdown files with test scenarios
  - Extract test names, steps, assertions
  - Validate scenario format (required fields)
  - Support include directives for shared steps
- Implement scenario generator:
  - Scan project files for testable code
  - Generate initial scenarios from UI components
  - Suggest missing test coverage
- Build report generation:
  - Markdown: Readable text report with pass/fail summary
  - JSON: Machine-readable with full details
  - HTML: Visual report with screenshots, charts
- Implement result storage:
  - Save results to `~/.local/share/testerarmy/results/`
  - Include timestamp, duration, screenshots
  - Enable filtering and searching
- Add export functionality:
  - Export specific test results
  - Export all results as archive
  - Share via URL (future: upload to TesterArmy Web)

**Success Criteria:**
- Markdown scenarios can be parsed and executed
- Reports are generated in multiple formats
- Historical results are stored and retrievable
- Results can be filtered by date, status, test name

---

### Phase 9: Polish (2-3 days)

**Goal:** Final polish, documentation, and testing

**Deliverables:**
- Comprehensive README
- Shell completion (bash, zsh, fish)
- Unit and integration tests
- CI/CD pipeline
- Code quality audit

**Details:**
- Configuration validation:
  - Validate JSON format on startup
  - Check required fields (provider, model)
  - Warn on deprecated settings
  - Provide helpful error messages
- Command aliases:
  - `test` → `run`
  - `gen` → `generate`
  - `rep` → `report`
- Shell completion:
  - Generate completion scripts for bash, zsh, fish
  - Complete file paths, command names, options
  - Install via `tester-army completion [shell]`
- README:
  - Installation instructions
  - Quick start guide
  - Configuration reference
  - Command documentation with examples
  - FAQ and troubleshooting
- Testing:
  - Unit tests for utilities, parsers
  - Integration tests for core workflows
  - Mock agent-browser for CI
  - Target 80% code coverage
- CI/CD:
  - GitHub Actions workflow
  - Run tests on every PR
  - Build and publish release
  - Auto-generate docs on release

**Success Criteria:**
- Config validation passes for valid configs
- Shell completion works for all commands
- 80%+ code coverage on unit tests
- CI pipeline passes on every PR
- README is comprehensive and helpful

## Project Structure

```
tester-army/
├── src/
│   ├── cli.ts              # Entry point
│   ├── tui/
│   │   ├── index.ts        # OpenTui setup
│   │   ├── app.tsx         # Main App component with providers
│   │   ├── context/
│   │   │   ├── args.tsx    # Args context
│   │   │   └── kv.tsx      # Key-value storage
│   │   ├── routes/
│   │   │   ├── home.tsx    # New test sessions
│   │   │   └── session/    # Test execution
│   │   │       ├── index.tsx       # Main session view
│   │   │       ├── header.tsx      # Session header
│   │   │       ├── sidebar.tsx     # Test results sidebar
│   │   │       └── footer.tsx      # Session footer
│   │   ├── component/
│   │   │   ├── prompt.tsx   # Input prompt
│   │   │   ├── message/     # Message components
│   │   │   │   ├── user.tsx
│   │   │   │   ├── assistant.tsx
│   │   │   │   └── test-result.tsx
│   │   │   ├── dialog/     # Dialog components
│   │   │   │   ├── model.tsx
│   │   │   │   ├── provider.tsx
│   │   │   │   └── export.tsx
│   │   │   └── ui/         # UI primitives
│   │   │       ├── button.tsx
│   │   │       ├── input.tsx
│   │   │       └── list.tsx
│   │   └── ui/
│   │       ├── toast.tsx   # Toast notifications
│   │       └── dialog.tsx  # Dialog overlay
│   ├── agent/
│   │   ├── index.ts        # Agent loop (Pi)
│   │   ├── providers.ts    # Provider manager (Pi)
│   │   └── tools.ts        # Browser tools
│   ├── browser/
│   │   ├── index.ts        # agent-browser wrapper
│   │   └── session.ts      # Session management
│   ├── workers/
│   │   ├── manager.ts      # Worker orchestration
│   │   └── worker.ts       # Worker process
│   ├── scenarios/
│   │   ├── parser.ts       # Markdown parser
│   │   └── generator.ts    # Scenario generator
│   ├── config/
│   │   ├── index.ts        # Config loading
│   │   └── providers.ts    # Provider configuration
│   └── utils/
│       ├── logger.ts
│       └── errors.ts
├── workers/
│   └── index.js            # Worker entry point
├── scenarios/
│   └── templates/          # Scenario templates
├── package.json
├── tsconfig.json
└── README.md
```

## Installation

```bash
# Install agent-browser
npm install -g agent-browser
brew install agent-browser  # macOS

# Install TesterArmy CLI
npm install -g @tester-army/cli
```

## Open Questions

1. **Self-Healing:**
   - Auto-fix DOM changes or suggest-and-confirm?
   - Version control for healed tests?

2. **Reporting:**
   - What formats beyond HTML/JSON?
   - Dashboard integration?

3. **Test Parallelization:**
   - Optimal worker count based on system resources?
   - Cross-browser testing support?

---

*Document version: 1.2*
*Updated: 2026-02-13*
*Changes: Added OpenCode-inspired UI patterns with SolidJS, provider layer, route-based navigation, context patterns*
*Stack: OpenTui (SolidJS) + Pi (pi-mono) + agent-browser*
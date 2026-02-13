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

```yaml
# ~/.testerarmy/config.yaml

primary_provider: openai
model: gpt-5.3-codex

providers:
  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4o
      - gpt-4o-mini
      - gpt-5.3-codex
  
  opencode:
    api_key: ${OPENCODE_API_KEY}
    models:
      - kimi-k2.5
      - kimi-k2-thinker

worker:
  parallel: 5
  timeout: 60000

browser:
  type: chromium
  headless: true
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

### Phase 1: Foundation
- Set up TypeScript project with SolidJS
- Install dependencies (OpenTui Solid bindings, Pi packages)
- Install agent-browser CLI
- Configure TypeScript and ESLint
- Set up configuration file (~/.testerarmy/config.yaml)

### Phase 2: Provider Integration
- Import Pi's provider manager
- Configure supported providers (OpenAI, Anthropic, OpenCode, etc.)
- Implement API key authentication
- Add custom provider support via models.json

### Phase 3: Core UI Framework (from OpenCode patterns)
- Create root app component with providers (SDK, Sync, Theme, Local, Keybind, Dialog)
- Implement route-based navigation (home vs session)
- Create context-based state management
- Implement command palette with slash commands
- Add keyboard shortcuts system

### Phase 4: agent-browser Integration
- Create agent-browser wrapper class
- Implement session management (multiple isolated browsers)
- Add ref parsing and element interaction
- Implement screenshot capture
- Add error handling and retries

### Phase 5: Agent Loop (from Pi)
- Import Pi's agent loop
- Configure browser tools (from agent-browser)
- Add assertion tools
- Implement test execution flow
- Add result collection

### Phase 6: Chat Interface (from OpenCode patterns)
- Create message components (UserMessage, AssistantMessage, TestResult)
- Implement scrollable message list with sticky scroll
- Add tool result display components
- Implement timeline navigation
- Create fork/branch functionality for test scenarios

### Phase 7: Worker Manager
- Create worker process spawning
- Implement parallel execution
- Add result aggregation
- Implement timeout handling
- Add worker lifecycle management

### Phase 8: Scenarios & Reports
- Create markdown scenario parser
- Implement scenario validation
- Add report generation (Markdown, JSON, HTML)
- Implement result storage
- Add export functionality

### Phase 9: Polish
- Add configuration file support
- Implement command aliases
- Add shell completion
- Create comprehensive README
- Add tests
- Set up CI/CD

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
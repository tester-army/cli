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

**Note:** PR integration and automated test execution on pull requests is handled by TesterArmy Web. This CLI focuses on local test development and execution.

**Stack:**
- **UI:** OpenTui (custom chat interface, test-focused)
- **Agent Library:** Pi (pi-mono) - provider abstraction, agent loop, extensions
- **Browser:** agent-browser - Rust CLI with Playwright daemon, ref-based interaction

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TesterArmy CLI (OpenTui)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Test-Focused Chat UI                                   │   │
│  │  - Scenario generation/display                          │   │
│  │  - Test progress indicators                            │   │
│  │  - Results reporting                                   │   │
│  │  - Worker orchestration                                │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Pi Library Layer                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Provider Manager                                        │   │
│  │  - 15+ providers (OpenAI, Anthropic, Google, etc.)      │   │
│  │  - API key & OAuth authentication                        │   │
│  │  - Custom providers via models.json                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Agent Loop                                              │   │
│  │  - Completion with tools                                │   │
│  │  - Extension system                                     │   │
│  │  - Session management                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     agent-browser                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Rust CLI + Node.js Daemon                              │   │
│  │  - 50+ commands (open, snapshot, click, screenshot)     │   │
│  │  - Ref-based interaction (@e1, @e2)                    │   │
│  │  - Multiple isolated sessions                           │   │
│  │  - Compact output (~200-400 tokens vs ~3000-5000)        │   │
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
tester-army - Interactive TUI mode (OpenTui)

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
- Set up TypeScript project
- Install dependencies (OpenTui, Pi packages)
- Install agent-browser CLI
- Configure TypeScript and ESLint
- Set up configuration file (~/.testerarmy/config.yaml)

### Phase 2: Pi Provider Integration
- Import Pi's provider manager
- Configure supported providers (OpenAI, Anthropic, OpenCode, etc.)
- Implement API key authentication
- Add custom provider support via models.json
- Create provider configuration UI in TUI

### Phase 3: agent-browser Integration
- Create agent-browser wrapper class
- Implement session management (multiple isolated browsers)
- Add ref parsing and element interaction
- Implement screenshot capture
- Add error handling and retries

### Phase 4: Agent Loop (from Pi)
- Import Pi's agent loop
- Configure browser tools (from agent-browser)
- Add assertion tools
- Implement test execution flow
- Add result collection

### Phase 5: Worker Manager
- Create worker process spawning
- Implement parallel execution
- Add result aggregation
- Implement timeout handling
- Add worker lifecycle management

### Phase 6: OpenTui Interface
- Initialize OpenTui application
- Create chat component
- Add progress indicators
- Implement results reporting
- Style with test-focused design

### Phase 7: Scenarios & Reports
- Create markdown scenario parser
- Implement scenario validation
- Add report generation (Markdown, JSON, HTML)
- Implement result storage
- Add export functionality

### Phase 8: Polish
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
│   │   ├── chat.ts         # Chat component
│   │   ├── progress.ts     # Progress indicators
│   │   └── report.ts       # Results reporting
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
│   └── templates/         # Scenario templates
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

*Document version: 1.0*
*Created: 2026-02-13*
*Stack: OpenTui + Pi (pi-mono) + agent-browser*
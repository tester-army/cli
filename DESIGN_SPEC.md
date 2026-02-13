# DESIGN_SPEC.md - TesterArmy CLI

> Autonomous AI QA Testing CLI

## Overview

TesterArmy CLI is an autonomous AI-powered QA testing agent specialized in software testing. It executes E2E tests from natural language prompts with deep testing expertise.

**Key Characteristics:**
- Testing-first agent with specialized testing knowledge
- Parallel browser execution for fast test suite runs
- Self-healing capability that adapts to UI changes
- Isolated browser sessions for each test
- Natural language test authoring

**Scenario Management:**
The main agent generates and maintains test scenarios as the codebase evolves:
- **Auto-generation:** Scan project files and generate relevant test scenarios
- **Maintenance:** Detect UI changes and update test scenarios accordingly
- **Refactoring:** Adapt test scenarios when application code changes
- **Coverage analysis:** Identify untested areas and suggest new scenarios

**Note:** PR integration is handled by TesterArmy Web. This CLI focuses on local test development.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     TesterArmy CLI                       │
│  ┌─────────────────────────────────────────────────┐     │
│  │  UI Layer (OpenTui + SolidJS)                   │     │
│  │  - Chat interface                              │     │
│  │  - Progress indicators                        │     │
│  │  - Results reporting                           │     │
│  │  - Command palette                             │     │
│  └─────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────┤
│                   Agent Layer (Pi)                      │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Provider abstraction                          │     │
│  │  Agent loop with tools                        │     │
│  │  Session history                              │     │
│  └─────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────┤
│                   Browser Layer                         │
│  ┌─────────────────────────────────────────────────┐     │
│  │  agent-browser CLI                            │     │
│  │  - Ref-based interaction                       │     │
│  │  - Multiple sessions                          │     │
│  │  - Screenshots                                │     │
│  └─────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────┤
│                   Worker Layer                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │Worker 1 │ │Worker 2 │ │Worker 3 │ │Worker N │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│     ↕            ↕            ↕            ↕           │
│  Isolated browser sessions per worker                 │
└─────────────────────────────────────────────────────────┘
```

## Key Features

- **Testing-Focused Agent:** Specialized assertions, DOM traversal, error diagnosis
- **Parallel Execution:** Multiple isolated browser sessions
- **Natural Language:** Write tests in plain English
- **Self-Healing:** Adapts to DOM changes automatically
- **Multi-Provider:** Configurable LLM providers

## Stack

| Layer | Tool |
|-------|------|
| UI | OpenTui with SolidJS |
| Agent | Pi (pi-mono) |
| Browser | agent-browser |

## CLI Commands

```bash
# Interactive mode
tester-army - Start interactive TUI

# Run tests
tester-army run <scenario.md> - Run scenario file
tester-army run ./tests/ - Run directory
tester-army run --parallel 5 - Parallel execution

# Generate tests
tester-army generate ./src/ - Scan project, generate scenarios
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
      "models": ["gpt-4o", "gpt-5.3-codex"]
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

## Scenario Format

```markdown
# Login Flow Tests

## Test 1: Successful Login
- Open https://example.com/login
- Type "test@example.com" into email field
- Type "password123" into password field
- Click "Login" button
- Assert URL contains "/dashboard"
```

## Implementation Phases

### Phase 1: Foundation
- Set up TypeScript project with SolidJS
- Install OpenTui, Pi packages, agent-browser CLI
- Configure project (TypeScript, ESLint)
- Create config file structure

### Phase 2: Provider Integration
- Integrate Pi's provider abstraction
- Implement provider configuration UI
- Add API key authentication
- Support model selection

### Phase 3: UI Framework
- Create main App component
- Implement route-based navigation (home/session)
- Build command palette with slash commands
- Add keyboard shortcuts
- Implement toast notifications

### Phase 4: Browser Integration
- Create agent-browser wrapper
- Implement session management
- Add ref parsing and interaction
- Implement screenshot capture
- Handle errors and retries

### Phase 5: Agent Loop
- Build agent with test tools
- Add browser control tools (open, click, type, screenshot)
- Add assertion tools (text, URL, title)
- Implement test execution flow
- Collect results

### Phase 6: Chat Interface
- Create message components (user, assistant, test result)
- Implement scrollable message list
- Add progress indicators
- Build timeline navigation
- Display test results with screenshots

### Phase 7: Worker Manager
- Create worker process spawning
- Implement parallel execution
- Add result aggregation
- Handle timeouts
- Manage worker lifecycle

### Phase 8: Scenarios
- Build scenario parser
- Store test history
- Results shown in TUI (separate reports in future phase)

### Phase 9: Polish
- Validate configuration
- Add shell completion
- Create README
- Write tests
- Set up CI/CD

## Project Structure

```
tester-army/
├── src/
│   ├── cli.ts              # Entry point
│   ├── tui/
│   │   ├── app.tsx         # Main app
│   │   ├── routes/         # Home & session routes
│   │   ├── components/    # UI components
│   │   └── ui/            # Dialogs, toasts
│   ├── agent/             # Pi integration
│   ├── browser/           # agent-browser wrapper
│   ├── workers/           # Worker orchestration
│   ├── scenarios/         # Parser & generator
│   ├── config/            # Config loading
│   └── utils/             # Helpers
├── workers/               # Worker entry points
├── scenarios/             # Templates
├── package.json
└── tsconfig.json
```

## Installation

```bash
# Install agent-browser
brew install agent-browser  # macOS
npm install -g agent-browser

# Install TesterArmy CLI
npm install -g @tester-army/cli
```

## Open Questions

1. Self-Healing: Auto-fix or suggest-and-confirm?
2. Parallelization: Optimal worker count?
3. Reports: Add in future phase (TUI shows results initially)

---

*Document version: 2.0*
*Cleaned up: 2026-02-13*
*Stack: OpenTui + Pi + agent-browser*
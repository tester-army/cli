name: agent-browser
description: Browser automation with agent-browser for AI agents.
triggers:
  - open
  - click
  - fill
  - screenshot
  - test web app
  - web automation
  - scrape
allowed-tools: Bash(agent-browser:*)

# Browser Automation with agent-browser

Core workflow:
1. `agent-browser open <url>`
2. `agent-browser snapshot -i` to gather refs (`@e1`, `@e2`)
3. interact with refs (`click`, `fill`, `select`, `check`, `press`)
4. re-snapshot after navigation or DOM changes

## Must-know commands

- `agent-browser open`, `close`, `snapshot -i`, `snapshot -i -C`, `snapshot -s "#selector"`
- `agent-browser click @e1`, `fill @e2 "text"`, `type`, `select`, `check`, `press`
- `agent-browser wait`, `agent-browser wait --load networkidle`, `agent-browser wait --url "**/x"`
- `agent-browser get text @e1`, `get url`, `get title`
- `agent-browser screenshot`, `screenshot --full`, `pdf output.pdf`
- `agent-browser state save/load`, `--session <name>`, `session list`

## Important rules

- Refs are invalidated on page change; always re-snapshot after navigation or dynamic updates.
- Prefer semantic fallback (`find text`, `find label`, `find role`) when refs are missing.
- For complex JS evaluation, use `eval --stdin`/`-b`.
- Visual debugging: `--headed`, `highlight`, `record start`.

## Platform notes

- macOS-first support for local desktop/browser flows.
- Supports local files and optional mobile iOS session workflows.

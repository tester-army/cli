<p align="center">
  <img src="https://github.com/user-attachments/assets/2eeb068a-36c4-43fb-838c-7e57b087cac3" alt="TesterArmy CLI" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> |
  <a href="https://tester.army/docs"><strong>Docs</strong></a> |
  <a href="https://tester.army"><strong>Platform</strong></a> |
  <a href="https://tester.army/dashboard/profile/api-keys"><strong>API Keys</strong></a> |
  <a href="#skill-installation"><strong>Skills</strong></a> |
  <a href="#mcp-server-and-plugins"><strong>MCP</strong></a> |
  <a href="#examples"><strong>Examples</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/testerarmy"><img src="https://img.shields.io/npm/v/testerarmy?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/testerarmy"><img src="https://img.shields.io/npm/dm/testerarmy?logo=npm" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
</p>

## Agents that test your app like real users.

TesterArmy CLI (`testerarmy` / `ta`) manages QA coverage in the TesterArmy dashboard
and queues runs that execute in TesterArmy cloud.

- Create and organize saved tests with plain-language steps.
- Run browser and mobile checks against saved environments.
- Wait for results and inspect run transcripts through JSON output.
- Feed concrete validation back to coding agents.

Start here:

- Docs: [tester.army/docs](https://tester.army/docs)
- Platform: [tester.army](https://tester.army)
- API keys:
  [tester.army/dashboard/profile/api-keys](https://tester.army/dashboard/profile/api-keys)

https://github.com/user-attachments/assets/f7524c3f-018e-46eb-9bae-cb69335fda64

</p>

## Quickstart

Install globally:

```bash
npm install -g testerarmy
```

Then create API key:

[tester.army/dashboard/profile/api-keys](https://tester.army/dashboard/profile/api-keys)

Authenticate (pick one):

```bash
ta auth
```

Or run without install:

```bash
npx testerarmy --help
```

Find a project and its saved tests, then wait for a cloud run:

```bash
ta projects list --json
ta tests list --project <projectId> --json
ta tests run <testId> --wait --json
```

Use IDs returned by the list commands. Without `--wait`, a successful command
only confirms that the run was queued. To validate development changes, save a
cloud-reachable preview or tunnel URL as a project environment and select it
with `--env <nameOrSlug>`.

## Skill Installation

Use skills CLI install:

```bash
npx skills add tester-army/cli
```

## MCP server and plugins

TesterArmy also runs as a hosted MCP server at `https://tester.army/mcp` (Streamable HTTP). It signs you in with your TesterArmy account through OAuth, so there is no API key to create or paste.

Claude Code:

```bash
claude mcp add --transport http testerarmy https://tester.army/mcp
```

Codex:

```bash
codex mcp add testerarmy --url https://tester.army/mcp
```

Or add it to `~/.codex/config.toml` and run `codex mcp login testerarmy`:

```toml
[mcp_servers.testerarmy]
url = "https://tester.army/mcp"
```

Cursor: open Customize and search for `testerarmy`, or click Add to Cursor on the marketplace listing. If the plugin is not listed yet, add the server by hand to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "testerarmy": {
      "url": "https://tester.army/mcp"
    }
  }
}
```

This repo is also a plugin that installs the MCP server and the `testerarmy-cli` skill together.

Claude Code: run `/plugin marketplace add tester-army/cli`, then `/plugin install testerarmy@testerarmy-agent-skills`.

Codex: the repo is a plugin marketplace too, so until TesterArmy appears in the Plugins Directory you can add it from here:

```bash
codex plugin marketplace add tester-army/cli
codex plugin add testerarmy@testerarmy-agent-skills
```

The plugin registers the hosted server for you; sign in once with `codex mcp login testerarmy`, or accept the sign-in prompt the ChatGPT app shows at install. In the ChatGPT desktop app, open this repository in Codex and the marketplace appears as a source in the Plugins tab.

Full reference for the server and its tools: https://docs.tester.army/cli/mcp

## Examples

Use the markdown scenarios in [`examples/`](examples/README.md) as authoring
references when creating saved dashboard tests with `ta tests create`.

- `examples/TESTER.md`
- `examples/tests/01-landing-page.md`
- `examples/tests/02-auth-smoke.md`
- `examples/tests/03-project-create.md`
- `examples/prompts/ad-hoc-regression.md`

Run a saved smoke group:

```bash
ta groups list --project <projectId> --json
ta tests run --group <groupId> --project <projectId> --wait --json
```

## Contributing

PRs welcome, especially for:

- improving skill quality and references
- better issue templates and triage process
- better real-world test examples

## License

MIT

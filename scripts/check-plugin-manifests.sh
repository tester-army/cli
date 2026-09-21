#!/usr/bin/env bash
# Keeps the plugin manifests, the Codex repo marketplace and the MCP Registry manifest (server.json) in step. Run locally or in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

files=(.claude-plugin/plugin.json .claude-plugin/marketplace.json .codex-plugin/plugin.json .cursor-plugin/plugin.json plugin.json .mcp.json mcp.json server.json .agents/plugins/marketplace.json)
for f in "${files[@]}"; do jq -e . "$f" >/dev/null || { echo "invalid JSON: $f"; exit 1; }; done

# name, version and description must match across every manifest and the marketplace entry
ref_name=$(jq -r .name plugin.json)
for key in name version description; do
  ref=$(jq -r ".$key" plugin.json)
  for f in .claude-plugin/plugin.json .codex-plugin/plugin.json .cursor-plugin/plugin.json; do
    [ "$(jq -r ".$key" "$f")" = "$ref" ] || { echo "$key differs in $f"; exit 1; }
  done
  [ "$(jq -r ".plugins[0].$key" .claude-plugin/marketplace.json)" = "$ref" ] || { echo "$key differs in marketplace entry"; exit 1; }
done

# the Codex interface block lives in two places (overlay + portable manifest); they must be identical
a=$(jq -S .interface .codex-plugin/plugin.json)
b=$(jq -S '.extensions["com.openai"].interface' plugin.json)
[ "$a" = "$b" ] || { echo "Codex interface block differs between .codex-plugin/plugin.json and plugin.json extensions.com.openai"; exit 1; }

# both MCP files must point at the same server URL
u1=$(jq -r '.mcpServers.testerarmy.url' .mcp.json)
u2=$(jq -r '.mcpServers.testerarmy.url' mcp.json)
[ "$u1" = "$u2" ] || { echo "MCP url differs: .mcp.json=$u1 mcp.json=$u2"; exit 1; }
[ "$(jq -r '.mcpServers.testerarmy.type' .mcp.json)" = "http" ] || { echo ".mcp.json must use type http (Claude Code)"; exit 1; }
[ "$(jq -r '.mcpServers.testerarmy.type' mcp.json)" = "streamable-http" ] || { echo "mcp.json must use type streamable-http (Agent Plugins)"; exit 1; }

# the registry manifest is published from main by .github/workflows/publish-mcp-registry.yml:
# same version as the plugins, same server URL as the MCP files
[ "$(jq -r .version server.json)" = "$(jq -r .version plugin.json)" ] || { echo "version differs in server.json (bump it with the plugin manifests)"; exit 1; }
[ "$(jq -r '.remotes[0].url' server.json)" = "$u1" ] || { echo "server.json remotes[0].url differs from the MCP files"; exit 1; }

# the Codex repo marketplace (.agents/plugins/marketplace.json, read by `codex plugin marketplace add tester-army/cli`
# and by the ChatGPT app) must point at this plugin under the same name as the Claude marketplace
[ "$(jq -r '.plugins[0].name' .agents/plugins/marketplace.json)" = "$ref_name" ] || { echo "Codex marketplace plugin name differs from plugin.json"; exit 1; }
[ "$(jq -r '.plugins[0].source.path' .agents/plugins/marketplace.json)" = "./" ] || { echo "Codex marketplace must reference the repo root (./)"; exit 1; }
[ "$(jq -r .name .agents/plugins/marketplace.json)" = "$(jq -r .name .claude-plugin/marketplace.json)" ] || { echo "Codex and Claude marketplace names differ"; exit 1; }

# referenced logo must exist
for p in "$(jq -r .logo .cursor-plugin/plugin.json)" "$(jq -r .interface.logo .codex-plugin/plugin.json)"; do
  [ -f "${p#./}" ] || { echo "missing logo file: $p"; exit 1; }
done

echo "plugin manifests consistent"

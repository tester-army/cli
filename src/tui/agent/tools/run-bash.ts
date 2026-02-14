import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter } from "node:path"
import { promisify } from "node:util"
import { Type } from "@sinclair/typebox"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import type { ToolInvocationPolicy } from "../types"

const execFileAsync = promisify(execFile)
const MAX_BASH_OUTPUT_BYTES = 1024 * 1024

function commandEnvironment(override?: Record<string, string>): Record<string, string> {
  const baseEnv = { ...process.env, ...(override ?? {}) }
  const workspaceBin = `${process.cwd()}/node_modules/.bin`
  const pathKey = Object.keys(baseEnv).find((key) => key.toLowerCase() === "path") ?? "PATH"
  const pathValue = baseEnv[pathKey] ?? ""
  const pathItems = pathValue.length > 0 ? pathValue.split(delimiter) : []
  const entries = new Set(pathItems)
  if (existsSync(workspaceBin)) {
    entries.add(workspaceBin)
  }
  const dedupedPath = Array.from(entries).join(delimiter)

  return {
    ...baseEnv,
    [pathKey]: dedupedPath,
  } as Record<string, string>
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`
}

function getWorkspaceNodeModulesBin(): string {
  return `${process.cwd()}/node_modules/.bin`
}

function toAgentBrowserCommand(command: string, env: Record<string, string>): string {
  const trimmed = command.trim()
  if (!trimmed.startsWith("agent-browser")) {
    return command
  }

  const workspaceBinary = `${getWorkspaceNodeModulesBin()}/agent-browser`
  const configuredBinary = (env.AGENT_BROWSER_BINARY ?? "").trim()
  const binary = configuredBinary.length > 0 ? configuredBinary : existsSync(workspaceBinary) ? workspaceBinary : "agent-browser"
  const args = trimmed.replace(/^agent-browser\b/i, "").trim()
  return `${shellQuote(binary)}${args ? ` ${args}` : ""}`
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return
  return Number.isFinite(value) ? value : undefined
}

function asOptionalInt(value: unknown): number | undefined {
  const numberValue = asOptionalNumber(value)
  if (numberValue === undefined) return
  return Math.round(numberValue)
}

function asEnvMap(value: unknown): Record<string, string> | undefined {
  const values = asObject(value)
  if (!values) return
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw === "string") {
      env[key] = raw
      continue
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      env[key] = String(raw)
    }
  }

  return Object.keys(env).length > 0 ? env : undefined
}

function toolResult(
  content: string,
  details: Record<string, unknown>,
): { content: { type: "text"; text: string }[]; details: Record<string, unknown> } {
  return {
    content: [{ type: "text", text: content }],
    details,
  }
}

function buildBashToolResult(
  command: string,
  stdout: string,
  stderr: string,
  timeoutMs: number,
  cwd: string | undefined,
  exitCode: number,
): Record<string, unknown> {
  return {
    command,
    exitCode,
    timeoutMs,
    cwd,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    elapsedMs: Date.now(),
    truncated: stdout.length > MAX_BASH_OUTPUT_BYTES || stderr.length > MAX_BASH_OUTPUT_BYTES,
  }
}

export interface RunBashToolOptions {
  getAbortSignal: () => AbortSignal | undefined
  shouldAllowTool?: ToolInvocationPolicy
  onStatus?: (status: string) => void
}

function commandHasDirectHttpCall(command: string): boolean {
  return /https?:\/\//i.test(command)
}

function usesAgentBrowser(command: string): boolean {
  return /\bagent-browser\b/.test(command)
}

function commandContainsDisallowedHttpClient(command: string): boolean {
  return /\bcurl\b|\bwget\b|\bhttp\b/i.test(command)
}

function normalizePythonCommand(command: string): string {
  return command.replace(/^(\s*(?:sudo\s+)?)python(?=\s|$|[;&|])/, "$1python3")
}

export function createRunBashTool(options: RunBashToolOptions): AgentTool {
  return {
    name: "run_bash",
    label: "Run a Bash command",
    description:
      "Execute a shell command in the local environment. For website and UI checks, use agent-browser commands only.",
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute with /bin/bash -lc." }),
      cwd: Type.Optional(Type.String({ description: "Optional working directory for command execution." })),
      timeoutMs: Type.Optional(
        Type.Integer({
          description: "Optional command timeout in milliseconds.",
          minimum: 250,
          maximum: 120_000,
        }),
      ),
      env: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
    }),
    execute: async (_toolCallId, params) => {
      const input = asObject(params)
      const command = asOptionalString(input?.command)
      if (!command) {
        throw new Error("command is required.")
      }

      const timeoutMs = asOptionalInt(input?.timeoutMs) ?? 60_000
      const cwd = asOptionalString(input?.cwd)
      const env = asEnvMap(input?.env)
      const hasUrl = commandHasDirectHttpCall(command)
      const usesAgentBrowserCommand = usesAgentBrowser(command)
      const disallowedHttpClient = commandContainsDisallowedHttpClient(command)
      const shellEnv = commandEnvironment(env)
      const preparedCommand = usesAgentBrowserCommand ? toAgentBrowserCommand(command, shellEnv) : command
      const commandToRun = normalizePythonCommand(preparedCommand)

      if (options.shouldAllowTool) {
        const allow = options.shouldAllowTool("run_bash", {
          command,
          cwd,
          ...(env ?? {}),
        })
        if (!allow) {
          return toolResult(
            "Tool-call guardrail reached. No further tool execution. Provide a concise testing summary and stop.",
            {
              command,
              exitCode: 0,
              reason: "tool_call_limit_reached",
              stop: true,
            },
          )
        }
      }

      if (hasUrl && !usesAgentBrowserCommand && disallowedHttpClient) {
        const reason =
          "Use agent-browser for website checks. Direct curl/wget/http commands are not allowed for testing."
        return {
          content: [{ type: "text", text: reason }],
          details: {
            command,
            exitCode: 1,
            error: reason,
          },
        }
      }

      if (hasUrl && !usesAgentBrowserCommand) {
        const reason =
          "For web page validation, use agent-browser commands (open, snapshot, click, fill, etc.) instead of direct HTTP commands."
        return {
          content: [{ type: "text", text: reason }],
          details: {
            command,
            exitCode: 1,
            error: reason,
          },
        }
      }

      const start = Date.now()
      const childEnv = shellEnv
      const abortSignal = options.getAbortSignal()

      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", commandToRun], {
          timeout: timeoutMs,
          cwd,
          encoding: "utf8",
          env: childEnv,
          maxBuffer: MAX_BASH_OUTPUT_BYTES,
          signal: abortSignal,
        })

        const result = buildBashToolResult(commandToRun, stdout || "", stderr || "", timeoutMs, cwd, 0)
        result.elapsedMs = Date.now() - start
        return toolResult(`Command executed successfully: ${command}`, result)
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException & {
          stdout?: unknown
          stderr?: unknown
        }
        const exitCode = typeof nodeError?.code === "number" ? nodeError.code : 1
        const stdout = typeof nodeError?.stdout === "string" ? nodeError.stdout : ""
        const stderr = typeof nodeError?.stderr === "string" ? nodeError.stderr : ""
        const message = `${stderr}\n${stdout}\n${nodeError?.message ?? ""}`.trim()
        if (usesAgentBrowserCommand) {
          const lowerMessage = message.toLowerCase()
          if (lowerMessage.includes("command not found") || lowerMessage.includes("not found")) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `agent-browser command unavailable in PATH.\nSet AGENT_BROWSER_BINARY to an absolute path, install it (npm install -g agent-browser), or add it to PATH, then retry.`,
                },
              ],
              details: {
                command: commandToRun,
                exitCode: Number.isFinite(exitCode) ? exitCode : 1,
                stdout,
                stderr,
              },
            }
          }
        }

        const details = buildBashToolResult(
          commandToRun,
          stdout,
          `${stderr}\n${nodeError?.message ?? ""}`.trim(),
          timeoutMs,
          cwd,
          exitCode,
        )
        details.error = nodeError?.message ?? "Command failed."
        details.elapsedMs = Date.now() - start
        return {
          content: [{ type: "text", text: `Command failed: ${details.error}` }],
          details,
        }
      }
    },
  }
}

export function buildOrchestratorTools(
  getAbortSignal: () => AbortSignal | undefined,
  shouldAllowTool?: ToolInvocationPolicy,
  onStatus?: (status: string) => void,
): AgentTool[] {
  return [createRunBashTool({ getAbortSignal, shouldAllowTool, onStatus })]
}

import { randomUUID } from "node:crypto"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { OrchestratorEvidence } from "./contracts"
import type { ParsedScenarioStep } from "./scenarioParser"

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 15000
const BROWSER_BINARY = "agent-browser"

export type StepAction = ParsedScenarioStep["kind"] | "close"

type SessionState = {
  currentUrl?: string
  lastTitle?: string
  stepRefCounter: number
  sessionFilePath?: string
}

const simulatedSessions = new Map<string, SessionState>()
let cliAvailability: boolean | null = null

function sessionState(sessionName: string): SessionState {
  let state = simulatedSessions.get(sessionName)
  if (!state) {
    state = { stepRefCounter: 0 }
    simulatedSessions.set(sessionName, state)
  }
  return state
}

function formatStepAction(action: string): string {
  return action.replace(/_/g, " ")
}

function toSafeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)
}

function hasAgentBrowserExecutable(): Promise<boolean> {
  if (cliAvailability !== null) {
    return Promise.resolve(cliAvailability)
  }

  return execFileAsync(BROWSER_BINARY, ["--help"], {
    timeout: 2000,
    encoding: "utf8",
    maxBuffer: 128 * 1024,
  })
    .then(() => {
      cliAvailability = true
      return true
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        cliAvailability = false
        return false
      }
      // If binary returns non-zero but exists, treat as available.
      if (typeof error.code === "string" && error.code !== "ENOENT") {
        cliAvailability = true
        return true
      }
      cliAvailability = false
      return false
    })
}

async function runAgentBrowserCommand(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; output: string; error: string }> {
  const available = await hasAgentBrowserExecutable()
  if (!available) {
    return {
      ok: false,
      output: "",
      error: "agent-browser binary not available",
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(BROWSER_BINARY, args, {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    })

    return {
      ok: true,
      output: stdout || stderr || "",
      error: "",
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === "ENOENT") {
        cliAvailability = false
        return {
          ok: false,
          output: "",
          error: "agent-browser binary not available",
        }
      }

      return {
        ok: false,
        output: (nodeError as { stdout?: string }).stdout?.toString() ?? "",
        error: nodeError.message,
      }
    }

    return {
      ok: false,
      output: "",
      error: "Unknown agent-browser invocation error.",
    }
  }
}

function buildCliArgs(sessionName: string, action: StepAction, input: ParsedScenarioStep): string[] {
  const base = ["--session", sessionName, action]
  switch (action) {
    case "open":
      return [...base, input.target ?? ""]
    case "click":
      return [...base, "--no-screenshot", input.target ?? ""]
    case "fill":
    case "type":
      return [...base, input.target ?? "", input.value ?? ""]
    case "press":
      return [...base, "key", input.target ?? ""]
    case "select":
      return [...base, input.target ?? "", input.value ?? ""]
    case "check":
      return [...base, input.target ?? ""]
    case "wait": {
      if (input.options?.waitMode === "url" && input.target) {
        return [...base, "--url", input.target]
      }
      if (input.options?.waitMode === "networkidle") {
        return [...base, "--load", "networkidle"]
      }
      if (input.options?.durationMs && input.options.durationMs > 0) {
        return [...base, "--ms", String(input.options.durationMs)]
      }
      return [...base]
    }
    case "snapshot":
      return [...base, "-i"]
    case "get_text":
      return [...base, "text", input.target ?? ""]
    case "get_url":
      return [...base, "url"]
    case "get_title":
      return [...base, "title"]
    case "screenshot":
      return [...base, "png"]
    case "close":
      return [...base, "close"]
    default:
      return [...base]
  }
}

async function simulatedAction(sessionName: string, action: StepAction, input: ParsedScenarioStep): Promise<AgentBrowserResult> {
  const state = sessionState(sessionName)
  const now = new Date().toISOString()
  const evidence: OrchestratorEvidence = {}

  if (action === "open") {
    state.currentUrl = input.target
    state.lastTitle = input.target ? `Page ${input.target}` : "Unknown"
    return {
      ok: true,
      text: `simulated ${action} ${input.target ?? ""}`.trim(),
      output: `Open ${input.target ?? ""}`,
      evidence,
      details: {
        session: sessionName,
        action,
        timestamp: now,
        url: input.target,
      },
    }
  }

  if (action === "snapshot") {
    state.stepRefCounter += 1
    const snapshotRef = `@e${state.stepRefCounter}`
    return {
      ok: true,
      text: `simulated snapshot @${snapshotRef}`,
      output: `Snapshot ${snapshotRef}`,
      evidence: {
        ...evidence,
        snapshotRef,
      },
      details: {
        session: sessionName,
        action,
        snapshotRef,
      },
    }
  }

  if (action === "get_url") {
    return {
      ok: true,
      text: state.currentUrl ?? "(empty url)",
      output: `URL ${state.currentUrl ?? ""}`,
      details: {
        session: sessionName,
        action,
        url: state.currentUrl ?? "",
      },
    }
  }

  if (action === "get_title") {
    return {
      ok: true,
      text: state.lastTitle ?? "Unknown",
      output: `Title ${state.lastTitle ?? ""}`,
      details: {
        session: sessionName,
        action,
        title: state.lastTitle ?? "",
      },
      evidence: {
        ...evidence,
        title: state.lastTitle,
      },
    }
  }

  if (action === "screenshot") {
    const sanitized = toSafeId(sessionName)
    const root = join(tmpdir(), "tester-army", "sessions")
    await mkdir(root, { recursive: true })
    const fileName = `${sanitized}-${randomUUID()}.png`
    const path = join(root, fileName)
    await writeFile(path, "")
    await appendFile(path, "")
    return {
      ok: true,
      text: `simulated screenshot ${path}`,
      output: path,
      evidence: {
        ...evidence,
        screenshot: path,
      },
      details: {
        session: sessionName,
        action,
        path,
      },
    }
  }

  if (action === "close") {
    return {
      ok: true,
      text: `simulated close ${sessionName}`,
      output: "closed",
      details: {
        session: sessionName,
        action,
      },
    }
  }

  if (action === "get_text") {
    return {
      ok: true,
      text: `simulated text for ${input.target ?? ""}`,
      output: `text:${input.target ?? ""}`,
      details: {
        session: sessionName,
        action,
        target: input.target ?? "",
      },
    }
  }

  if (action === "wait") {
    if (input.options?.durationMs && input.options.durationMs > 0) {
      return {
        ok: true,
        text: `simulated wait ${input.options.durationMs}ms`,
        output: `waited ${input.options.durationMs}ms`,
        details: {
          session: sessionName,
          action,
          durationMs: input.options.durationMs,
        },
      }
    }

    return {
      ok: true,
      text: "simulated wait",
      output: "waited",
      details: {
        session: sessionName,
        action,
      },
    }
  }

  return {
    ok: true,
    text: `simulated ${formatStepAction(action)} (${input.target ?? ""}${input.value ? `, ${input.value}` : ""})`,
    output: `executed ${action}`,
    details: {
      session: sessionName,
      action,
      target: input.target,
      value: input.value,
    },
  }
}

export interface AgentBrowserResult {
  ok: boolean
  text: string
  output: string
  evidence?: OrchestratorEvidence
  details: Record<string, unknown>
}

export async function runAgentBrowserStep(
  sessionName: string,
  action: StepAction,
  step: ParsedScenarioStep,
  timeoutMs?: number,
): Promise<AgentBrowserResult> {
  const available = await hasAgentBrowserExecutable()
  if (!available) {
    const fallback = await simulatedAction(sessionName, action, step)
    fallback.text = `simulated ${formatStepAction(action)}: agent-browser unavailable`
    return {
      ...fallback,
      details: {
        ...fallback.details,
        session: sessionName,
        action,
        simulated: true,
        unavailable: true,
      },
    }
  }

  const cliResult = await runAgentBrowserCommand(buildCliArgs(sessionName, action, step), timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (!cliResult.ok) {
    return {
      ok: false,
      text: `agent-browser failed: ${cliResult.error || "command failed"}`,
      output: cliResult.output,
      evidence: {
        agentBrowserLogs: [cliResult.error, cliResult.output].filter(Boolean).join("\n"),
      },
      details: {
        session: sessionName,
        action,
        output: cliResult.output,
        commandFailed: true,
      },
    }
  }

  return {
    ok: true,
    text: cliResult.output,
    output: cliResult.output,
    details: {
      session: sessionName,
      action,
      output: cliResult.output,
      simulated: false,
    },
  }
}

export function buildSessionName(runId: string, workerId: string): string {
  return `testerarmy-${runId}-${workerId}`
}

export async function closeSession(sessionName: string): Promise<void> {
  if (!sessionName) return
  const placeholderStep: ParsedScenarioStep = {
    id: "",
    kind: "snapshot",
    label: "close",
    raw: "close",
  }
  simulatedSessions.delete(sessionName)
  await runAgentBrowserStep(sessionName, "close", placeholderStep)
}

import { existsSync } from "node:fs"
import { basename } from "node:path"
import { checkRun, cancelRun, startWorkers, subscribe } from "./orchestrator/orchestrator"
import type { RunCheckResult, RunEvent } from "./orchestrator/contracts"

type FailurePolicy = "continue-all" | "fail-fast"
type ScreenshotPolicy = "always" | "on-failure" | "never"

export type RunCliArgs = {
  scenarioPath?: string
  goal?: string
  targetUrl?: string
  parallelism?: number
  failurePolicy?: FailurePolicy
  stepTimeoutMs?: number
  scenarioTimeoutMs?: number
  screenshotPolicy?: ScreenshotPolicy
  labels?: string[]
  modelId?: string
  json?: boolean
  showHelp?: boolean
}

type CompletionResult = {
  code: number
  runId: string
  status: RunCheckResult["status"]
  aggregate: RunCheckResult["aggregate"] | null
  events: Array<{ event: RunEvent["event"]; timestamp: string; workerId?: string; message: string }>
}

const DEFAULT_TIMEOUT_MS = 15_000

function toPositiveInteger(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : fallback
}

function toSafeText(value: unknown) {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeFailurePolicy(value: unknown): FailurePolicy {
  const candidate = toSafeText(value)?.toLowerCase()
  return candidate === "fail-fast" ? "fail-fast" : "continue-all"
}

function normalizeScreenshotPolicy(value: unknown): ScreenshotPolicy {
  const candidate = toSafeText(value)?.toLowerCase()
  if (candidate === "always" || candidate === "never") return candidate
  return "on-failure"
}

function buildStartInput(args: RunCliArgs) {
  const scenarioPath = toSafeText(args.scenarioPath)
  const goal = toSafeText(args.goal)
  const targetUrl = toSafeText(args.targetUrl)
  const modelId = toSafeText(args.modelId)
  const labels = (args.labels ?? []).map((label) => label.trim()).filter((label) => label.length > 0)

  return {
    scenarioPath,
    targetUrl,
    goal,
    parallelism: toPositiveInteger(args.parallelism, 4),
    failurePolicy: normalizeFailurePolicy(args.failurePolicy),
    stepTimeoutMs: toPositiveInteger(args.stepTimeoutMs, DEFAULT_TIMEOUT_MS),
    scenarioTimeoutMs: toPositiveInteger(args.scenarioTimeoutMs, 120_000),
    screenshotPolicy: normalizeScreenshotPolicy(args.screenshotPolicy),
    labels,
    modelId,
  }
}

function eventMessage(event: RunEvent) {
  const base = `[${event.timestamp}]`
  const baseName = event.workerId ? ` (${event.workerId})` : ""
  const payload = event.payload as Record<string, unknown>
  if (event.event === "run.started") {
    return `${base} run.started: ${payload.runId ?? "run"} ${event.scenarioId}`
  }
  if (event.event === "run.finished") {
    return `${base} run.finished`
  }
  if (event.event === "run.cancelled") {
    return `${base} run.cancelled`
  }
  if (event.event === "issue") {
    const title = typeof payload.title === "string" ? payload.title : "Issue reported"
    const severity = typeof payload.issue?.severity === "string" ? payload.issue.severity : "unknown"
    return `${base} issue${baseName}: ${severity.toUpperCase()} ${title}`
  }
  if (event.event === "step.start") {
    const label = toSafeText((payload as Record<string, unknown>).label) ?? "step"
    const attempt = typeof payload.attempt === "number" ? ` #${payload.attempt}` : ""
    return `${base} step.start${baseName}: ${label}${attempt}`
  }
  if (event.event === "step.complete") {
    const label = toSafeText((payload as Record<string, unknown>).label) ?? "step"
    const status = toSafeText((payload as Record<string, unknown>).status) ?? "done"
    return `${base} step.complete${baseName}: ${status} ${label}`
  }
  if (event.event === "error") {
    const reason = toSafeText((payload as Record<string, unknown>).reason) ?? "unknown"
    return `${base} error${baseName}: ${reason}`
  }
  return `${base} ${event.event}`
}

function buildFinalCode(result: RunCheckResult, eventCount: number): number {
  if (result.status === "cancelled") return 130
  if (result.status === "error") return 1
  if (!result.aggregate) return 0
  if (result.aggregate.status === "passed" && result.aggregate.issues.length === 0 && eventCount > 0) return 0
  return result.aggregate.status === "failed" || result.aggregate.status === "error" ? 1 : 0
}

function looksLikeImage(pathValue: unknown): boolean {
  if (typeof pathValue !== "string") return false
  return ["png", "webp", "jpg", "jpeg", "gif"].includes(basename(pathValue).split(".").pop()?.toLowerCase() ?? "")
}

async function waitForCompletion(runId: string): Promise<RunCheckResult> {
  while (true) {
    const result = checkRun(runId)
    if (result.status !== "running") return result
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

export async function runHeadlessMode(args: RunCliArgs): Promise<number> {
  const input = buildStartInput(args)
  if (!input.scenarioPath && !input.targetUrl && !input.goal) {
    console.error("No run input. Provide --scenario-path, --target-url, or --goal.")
    return 2
  }

  const events: CompletionResult["events"] = []
  let completion: CompletionResult | undefined
  let runId = "run-unknown"
  let started = false
  let unsub = () => {}
  let completionCode = 0
  const spawn = startWorkers(input)

  const onSigInt = async () => {
    if (!started || !runId) return
    try {
      await cancelRun(runId)
      console.log(`Cancelling run ${runId}...`)
    } catch {
      // Ignore cancellation failures, preserve default signal behavior.
    }
  }

  const safeRunId = () => runId.trim().length > 0
  try {
    const startedRun = await spawn
    runId = startedRun.runId
    started = true
    process.on("SIGINT", onSigInt)

    if (!safeRunId()) {
      throw new Error("Cannot identify started run")
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: "started",
            runId,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(`Started run ${runId}`)
      console.log(`Mode: ${input.parallelism} worker(s), ${input.failurePolicy}, ${input.screenshotPolicy}`)
      if (input.scenarioPath) {
        console.log(`Scenario source: ${input.scenarioPath}`)
      } else if (input.targetUrl) {
        console.log(`Target URL: ${input.targetUrl}`)
      }
      if (input.goal) console.log(`Goal: ${input.goal}`)
    }

    unsub = subscribe((event) => {
      if (event.runId !== runId) return
      const message = eventMessage(event)
      events.push({ event: event.event, timestamp: event.timestamp, workerId: event.workerId, message })
      if (!args.json) {
        console.log(message)
      }
    })

    const result = await waitForCompletion(runId)
    unsub()
    process.off("SIGINT", onSigInt)
    completion = {
      code: buildFinalCode(result, events.length),
      runId,
      status: result.status,
      aggregate: result.aggregate ?? null,
      events,
    }
    completionCode = completion.code
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: completionCode === 0,
            runId,
            status: result.status,
            aggregate: result.aggregate ?? null,
            events,
          },
          null,
          2,
        ),
      )
    } else if (result.aggregate) {
      const timing = result.aggregate.timing
      const issueCount = result.aggregate.issues.length
      const screenshotEvidence = result.aggregate.issues.reduce((count, issue) => {
        return issue.evidence?.screenshot && existsSync(issue.evidence.screenshot) && looksLikeImage(issue.evidence.screenshot)
          ? count + 1
          : count
      }, 0)
      console.log(`Summary: passed=${result.aggregate.passed} failed=${result.aggregate.failed} skipped=${result.aggregate.skipped}`)
      console.log(`Issues: ${issueCount} (${screenshotEvidence} with screenshots)`)
      console.log(`Wall clock: ${timing.wallClockMs}ms, execution: ${timing.executionMs}ms`)
    }
  } catch (error) {
    unsub()
    process.off("SIGINT", onSigInt)
    const message = error instanceof Error ? error.message : "Failed to start run"
    if (args.json) {
      console.log(JSON.stringify({ ok: false, message }, null, 2))
    } else {
      console.error(`Run failed to start: ${message}`)
    }
    return 1
  }

  if (!started || !completion) {
    return 1
  }

  if (args.json) {
    return completionCode
  }

  if (completion.status === "cancelled") {
    console.log("Run cancelled.")
  } else if (completion.code === 0) {
    console.log("Run completed successfully.")
  } else {
    console.log("Run completed with issues.")
  }

  return completion.code
}

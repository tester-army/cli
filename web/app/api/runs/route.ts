import { NextResponse, type NextRequest } from "next/server"
import { listRuns, startWorkers } from "@app/orchestrator/orchestrator"
import type { RunRecordSummary, RunSpawnResult, StartRunInput } from "@app/orchestrator/contracts"

type ApiResponse<T> = {
  ok: boolean
  data?: T
  message?: string
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeFailurePolicy(value: unknown): StartRunInput["failurePolicy"] {
  const candidate = toTrimmedString(value)
  return candidate === "fail-fast" ? "fail-fast" : "continue-all"
}

function normalizeScreenshotPolicy(value: unknown): StartRunInput["screenshotPolicy"] {
  const candidate = toTrimmedString(value)
  return candidate === "always" || candidate === "never" ? candidate : "on-failure"
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const rounded = Math.max(1, Math.round(number))
  return Number.isFinite(rounded) ? rounded : fallback
}

function toLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0)
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  return []
}

function parseStartPayload(body: unknown): StartRunInput {
  const input = body as Record<string, unknown> | undefined
  const scenarioPath = toTrimmedString(input?.scenarioPath)
  const targetUrl = toTrimmedString(input?.targetUrl)
  const goal = toTrimmedString(input?.goal)
  const modelId = toTrimmedString(input?.modelId)

  return {
    scenarioPath,
    targetUrl,
    goal,
    parallelism: toPositiveInteger(input?.parallelism, 4),
    failurePolicy: normalizeFailurePolicy(input?.failurePolicy),
    screenshotPolicy: normalizeScreenshotPolicy(input?.screenshotPolicy),
    stepTimeoutMs: toPositiveInteger(input?.stepTimeoutMs, 15_000),
    scenarioTimeoutMs: toPositiveInteger(input?.scenarioTimeoutMs, 120_000),
    labels: toLabels(input?.labels),
    modelId,
  }
}

export async function GET() {
  const runs = listRuns().sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
  return NextResponse.json<ApiResponse<RunRecordSummary[]>>({ ok: true, data: runs })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    const input = parseStartPayload(body)
    if (!input.scenarioPath && !input.targetUrl && !input.goal) {
      return NextResponse.json<ApiResponse<never>>(
        { ok: false, message: "scenarioPath, targetUrl, or goal is required" },
        { status: 400 },
      )
    }

    const started = await startWorkers(input)
    return NextResponse.json<ApiResponse<RunSpawnResult>>({ ok: true, data: started }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start run"
    return NextResponse.json<ApiResponse<never>>({ ok: false, message }, { status: 400 })
  }
}

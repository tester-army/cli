import { readdir, mkdir, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { getEnvApiKey, getOAuthApiKey, getOAuthProvider, type OAuthCredentials } from "@mariozechner/pi-ai"
import { executeWorkerScenario, buildWorkerSessionName, closeWorkerSession, type WorkerRuntimeContext } from "./workerEngine"
import {
  type FailurePolicy,
  type OrchestratorIssue,
  type OrchestratorEventListener,
  type ReportIssueInput,
  type RunAggregate,
  type RunCheckResult,
  type RunEvent,
  type RunRecordSummary,
  type RunSpawnResult,
  type StartRunInput,
  type WorkerExecutionState,
  type WorkerSummary,
} from "./contracts"
import type { ParsedScenarioStep, ParsedScenarioTask } from "./scenarioParser"
import { parseScenarioFiles } from "./scenarioParser"

type ActiveRunRecord = {
  runId: string
  scenarioPath: string
  startedAt: number
  endedAt?: number
  status: "running" | "finished" | "cancelled" | "error"
  parallelism: number
  failurePolicy: FailurePolicy
  stepTimeoutMs: number
  scenarioTimeoutMs: number
  screenshotPolicy: "always" | "on-failure" | "never"
  labels: string[]
  modelId?: string
  modelApiKey?: string
  workers: WorkerExecutionState[]
  issues: OrchestratorIssue[]
  workerSummaries: WorkerSummary[]
  totalScenarios: number
  stepsCompleted: number
  totalSteps: number
  cancelToken: { cancelled: boolean }
  queuedMs: number
  scenarioTasks: ParsedScenarioTask[]
  nextScenarioIndex: number
  runStopReason?: "manual" | "fail-fast"
}

const listeners = new Set<OrchestratorEventListener>()
const runs = new Map<string, ActiveRunRecord>()

const DEFAULT_PARALLELISM = 4
const MAX_PARALLELISM = 16
const DEFAULT_FAILURE_POLICY: FailurePolicy = "continue-all"
const DEFAULT_STEP_TIMEOUT_MS = 15000
const DEFAULT_SCENARIO_TIMEOUT_MS = 120000
const ORCHESTRATOR_CONFIG_PATH = process.env.TESTER_ARMY_CONFIG ?? `${process.env.HOME ?? ""}/.config/testerarmy/testerarmy.json`

function toIso(time: number) {
  return new Date(time).toISOString()
}

function parseModelProvider(modelId: string | undefined): string {
  const trimmed = modelId?.trim() ?? "openai"
  const separator = trimmed.indexOf(":")
  if (separator > 0) {
    const provider = trimmed.slice(0, separator).trim().toLowerCase()
    return provider.length > 0 ? provider : "openai"
  }
  return "openai"
}

function newRunId() {
  const random = Math.random().toString(16).slice(2, 10)
  return `run-${Date.now().toString(16)}-${random}`
}

function clampParallelism(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PARALLELISM
  }

  const rounded = Math.max(1, Math.round(value))
  if (rounded > MAX_PARALLELISM) return MAX_PARALLELISM

  return rounded
}

function clampTimeoutMs(value: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.max(250, Math.round(value))
}

type StoredConfig = Record<string, unknown>

async function readStoredConfig(): Promise<StoredConfig | undefined> {
  const file = Bun.file(ORCHESTRATOR_CONFIG_PATH)
  if (!(await file.exists())) {
    return
  }

  return file
    .json()
    .then((value) => asObject(value))
    .catch(() => undefined)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function asRecordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return
  return Number.isFinite(value) ? value : undefined
}

function toOAuthCredentials(value: unknown): OAuthCredentials | undefined {
  const record = asRecord(value)
  const refresh = typeof asString(record?.refresh) === "string" ? asString(record?.refresh) : undefined
  const access = typeof asString(record?.access) === "string" ? asString(record?.access) : undefined
  const expires = asNumber(record?.expires)

  if (!refresh || !access || typeof expires !== "number") return
  return {
    ...(record as OAuthCredentials),
    refresh,
    access,
    expires,
  }
}

async function loadProviderAuthMap(): Promise<Record<string, OAuthCredentials>> {
  const config = await readStoredConfig()
  const providers = asRecord(config?.providers)
  const rawAuth = asRecord(providers?.auth)
  if (!rawAuth) return {}

  const auth: Record<string, OAuthCredentials> = {}
  for (const [providerId, rawValue] of Object.entries(rawAuth)) {
    const credentials = toOAuthCredentials(rawValue)
    if (credentials) {
      auth[providerId.toLowerCase()] = credentials
    }
  }

  return auth
}

async function persistProviderAuth(providerId: string, credentials: OAuthCredentials): Promise<void> {
  const config = (await readStoredConfig()) ?? {}
  const providers = asRecord(config.providers) ?? {}
  const existingAuth = asRecord(providers.auth) ?? {}

  providers.auth = {
    ...existingAuth,
    [providerId]: {
      type: "oauth",
      ...credentials,
    },
  }

  config.providers = providers
  await mkdir(dirname(ORCHESTRATOR_CONFIG_PATH), { recursive: true })
  await Bun.write(ORCHESTRATOR_CONFIG_PATH, JSON.stringify(config, null, 2))
}

async function resolveModelApiKey(modelId: string | undefined): Promise<string | undefined> {
  const provider = parseModelProvider(modelId)
  const settings = await readRuntimeConfig()
  const configuredProvider = normalizeProviderId(settings?.provider)
  const configuredApiKey = settings?.apiKey

  if (configuredProvider === provider && configuredApiKey) {
    return configuredApiKey
  }

  const providerFromEnv = getEnvApiKey(provider)
  if (providerFromEnv) {
    return providerFromEnv
  }

  if (!getOAuthProvider(provider)) {
    return undefined
  }

  const authMap = await loadProviderAuthMap()
  const oauthResult = await getOAuthApiKey(provider, authMap)
  if (!oauthResult) {
    return
  }

  if (oauthResult.newCredentials) {
    await persistProviderAuth(provider, oauthResult.newCredentials)
  }

  return oauthResult.apiKey
}

async function readRuntimeConfig(): Promise<{ provider?: string; apiKey?: string } | undefined> {
  const path = ORCHESTRATOR_CONFIG_PATH
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) return undefined

  const data = asObject(await file.json().catch(() => undefined))
  if (!data) return undefined

  const providers = asRecord(data.providers)
  const piMono = asRecord(providers?.piMono)
  return {
    provider:
      process.env.PI_MONO_PROVIDER ??
      asRecordString(providers, "primary") ??
      asRecordString(piMono, "provider") ??
      "openai",
    apiKey:
      process.env.PI_MONO_API_KEY ??
      asRecordString(piMono, "apiKey"),
  }
}

function normalizeProviderId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function makeWorkers(total: number): WorkerExecutionState[] {
  return Array.from({ length: total }, (_, index) => {
    const name = `Worker ${index + 1}`
    return {
      id: `worker-${index + 1}`,
      name,
      status: "idle",
      scenario: undefined,
      progressText: "queued",
      elapsedMs: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      issues: [],
    }
  })
}

function issueSummariesFromWorkers(workers: WorkerExecutionState[]): WorkerSummary[] {
  return workers.map((worker) => ({
    workerId: worker.id,
    scenario: worker.scenario ?? "unknown",
    passed: worker.passed ?? 0,
    failed: worker.failed ?? 0,
    skipped: worker.skipped ?? 0,
    timeMs: worker.elapsedMs ?? 0,
    issues: worker.issues ?? [],
    safetyNotes: [],
    status: worker.status === "done" ? "passed" : worker.status === "error" ? "failed" : "cancelled",
  }))
}

function buildAggregate(run: ActiveRunRecord): RunAggregate {
  const summaries = issueSummariesFromWorkers(run.workers)
  const passed = summaries.reduce((total, summary) => total + summary.passed, 0)
  const failedFromWorkers = summaries.reduce((total, summary) => total + summary.failed, 0)
  const issueCount = run.issues.length
  const failed = failedFromWorkers + issueCount
  const skipped = summaries.reduce((total, summary) => total + summary.skipped, 0)
  const wallClock = (run.endedAt ?? Date.now()) - run.startedAt
  const executionMs = Math.max(0, wallClock - run.queuedMs)
  let status: RunAggregate["status"] = "passed"

  if (run.status === "cancelled") {
    status = "partial"
  } else if (run.status === "error" || run.runStopReason === "fail-fast") {
    status = "error"
  } else if (failed > 0) {
    status = "failed"
  }

  return {
    runId: run.runId,
    startedAt: toIso(run.startedAt),
    endedAt: toIso(run.endedAt ?? Date.now()),
    status,
    scenariosTotal: run.totalScenarios,
    passed,
    failed,
    skipped,
    issues: [...run.issues],
    workerSummaries: summaries,
    timing: {
      wallClockMs: wallClock,
      queuedMs: run.queuedMs,
      executionMs,
      overheadMs: Math.max(0, run.queuedMs),
    },
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
}

function stripTrailingUrlPunctuation(value: string) {
  return value.replace(/[)\]}>.,;:'"]+$/g, "")
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || /^www\./i.test(value.trim())
}

function extractUrlFromText(value: string | undefined): string | undefined {
  const text = asString(value)
  if (!text) return

  const directMatch = /(https?:\/\/[^\s<>"')\]}>]+)/i.exec(text)
  if (directMatch?.[0]) {
    return stripTrailingUrlPunctuation(directMatch[0].trim())
  }

  const withWwwMatch = /\b(www\.[^\s<>"')\]}>]+)/i.exec(text)
  if (withWwwMatch?.[0]) {
    return `https://${stripTrailingUrlPunctuation(withWwwMatch[0].trim())}`
  }

  return
}

function newStepId() {
  return `step-${Math.random().toString(16).slice(2, 10)}`
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function buildAdHocScenarioTask(input: Pick<StartRunInput, "goal" | "targetUrl">): ParsedScenarioTask {
  const goal = asString(input.goal)
  const explicitUrl = asString(input.targetUrl)
  const targetUrl = extractUrlFromText(explicitUrl ?? goal)
  const warning: string[] = []

  if (!targetUrl && goal) {
    warning.push("No URL detected in goal; worker will act on the goal text directly.")
  } else if (targetUrl && goal) {
    warning.push(`Executing ad-hoc task for ${targetUrl}.`)
  }

  const steps: ParsedScenarioStep[] = []

  if (targetUrl) {
    steps.push({
      id: newStepId(),
      kind: "open",
      label: `open ${targetUrl}`,
      raw: `open ${targetUrl}`,
      target: targetUrl,
      options: {
        target: targetUrl,
      },
    })
  }

  if (goal) {
    steps.push({
      id: newStepId(),
      kind: "unsupported",
      label: "ad-hoc goal",
      raw: goal,
      note: "Ad-hoc goal provided by the main orchestrator.",
      options: {
        target: goal,
      },
    })
  }

  if (steps.length === 0) {
    steps.push({
      id: newStepId(),
      kind: "unsupported",
      label: "ad-hoc task",
      raw: "Run ad-hoc task",
      note: "No scenario instructions were provided.",
      options: {},
    })
  }

  const normalizedGoal = goal ? truncateText(goal, 80) : "Ad-hoc task"
  return {
    scenarioId: `ad-hoc:${normalizedGoal}`,
    sourcePath: targetUrl ?? "ad-hoc",
    fileName: targetUrl ? `ad-hoc:${targetUrl}` : "ad-hoc",
    title: goal ? `Ad-hoc: ${normalizedGoal}` : `Ad-hoc: ${targetUrl ?? "task"}`,
    index: 0,
    steps,
    warnings: warning,
  }
}

function buildAdHocScenarioPath(input: Pick<StartRunInput, "goal" | "targetUrl">): string {
  const targetUrl = extractUrlFromText(input.targetUrl)
  if (targetUrl) return `ad-hoc:${targetUrl}`

  const goal = asString(input.goal)
  if (goal) return `ad-hoc:${truncateText(goal, 60)}`

  return "ad-hoc:task"
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 1
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function normalizeEvidence(value: unknown) {
  const source = asObject(value)
  if (!source) return {}
  return {
    screenshot: asString(source.screenshot),
    snapshotRef: asString(source.snapshotRef),
    agentBrowserLogs: asString(source.agentBrowserLogs),
    url: asString(source.url),
    title: asString(source.title),
  }
}

function normalizeIssue(input: ReportIssueInput): Omit<OrchestratorIssue, "severity"> & { severity: OrchestratorIssue["severity"] } {
  return {
    title: asString(input.title) ?? "",
    severity: input.severity,
    area: asString(input.area) ?? "",
    expected: asString(input.expected) ?? "",
    actual: asString(input.actual) ?? "",
    steps: asStringArray(input.steps),
    evidence: normalizeEvidence(input.evidence),
    confidence: clampConfidence(input.confidence),
  }
}

function resolveRunForIssue(runId?: string): ActiveRunRecord {
  if (runId && runId.trim().length > 0) {
    const exact = runs.get(runId)
    if (!exact) {
      throw new Error(`Cannot report issue: runId "${runId}" not found.`)
    }
    return exact
  }

  const running = Array.from(runs.values()).filter((run) => run.status === "running")
  if (running.length === 1) return running[0]

  if (running.length > 1) {
    throw new Error("Multiple running runs found. Provide runId with report_issue.")
  }

  const allRuns = Array.from(runs.values())
  if (allRuns.length === 0) {
    throw new Error("No run context available for report_issue.")
  }

  return allRuns.sort((left, right) => right.startedAt - left.startedAt)[0]
}

function attachIssueToWorker(
  run: ActiveRunRecord,
  workerId: string | undefined,
  issue: OrchestratorIssue,
): OrchestratorIssue[] {
  if (!workerId) return run.issues

  const worker = run.workers.find((entry) => entry.id === workerId)
  if (!worker) {
    throw new Error(`report_issue workerId "${workerId}" does not exist in run ${run.runId}.`)
  }

  worker.issues = [...(worker.issues ?? []), issue]
  worker.failed = (worker.failed ?? 0) + 1
  return run.issues
}

export function reportIssue(input: ReportIssueInput): { runId: string; issue: OrchestratorIssue; totalIssues: number } {
  const run = resolveRunForIssue(input.runId)
  const issue: OrchestratorIssue = normalizeIssue(input)
  attachIssueToWorker(run, input.workerId?.trim(), issue)
  run.issues = [...run.issues, issue]

  const scenario = input.scenario ?? run.scenarioPath
  emit({
    runId: run.runId,
    scenarioId: scenario,
    workerId: input.workerId,
    event: "issue",
    payload: {
      runId: run.runId,
      workerId: input.workerId,
      issue,
    },
  })

  return {
    runId: run.runId,
    issue,
    totalIssues: run.issues.length,
  }
}

function emit(event: Omit<RunEvent, "timestamp">) {
  const now = toIso(Date.now())
  const payload: RunEvent = { ...event, timestamp: now }
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch {
      // Keep orchestrator resilient if one listener fails.
    }
  }
}

function createScenarioList(inputPath: string): Promise<string[]> {
  const path = resolve(inputPath)

  return stat(path).then(async (info) => {
    if (info.isFile()) {
      return [path]
    }

    if (info.isDirectory()) {
      const entries = await readdir(path, { recursive: true, withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        .map((entry) => join(entry.parentPath ?? path, entry.name))
    }

    return []
  })
}

async function loadScenarioTaskListFromPath(
  inputPath: string,
): Promise<{ scenarioPath: string; scenarioTasks: ParsedScenarioTask[] }> {
  const path = resolve(inputPath)
  const scenarioFiles = await createScenarioList(path)
  if (scenarioFiles.length === 0) {
    throw new Error(`No scenario files found in ${inputPath}`)
  }

  const scenarioTasks = await parseScenarioFiles(scenarioFiles)
  if (scenarioTasks.length === 0) {
    throw new Error(`No runnable scenarios found in ${inputPath}`)
  }

  return { scenarioPath: path, scenarioTasks }
}

function resolveScenarioSource(input: StartRunInput): Promise<{ scenarioPath: string; scenarioTasks: ParsedScenarioTask[] }> {
  const scenarioPath = asString(input.scenarioPath)
  const goal = asString(input.goal)
  const targetUrl = asString(input.targetUrl)

  if (!scenarioPath && !goal && !targetUrl) {
    return Promise.reject(new Error("scenarioPath, targetUrl, or goal is required."))
  }

  if (!scenarioPath) {
    return Promise.resolve({
      scenarioPath: buildAdHocScenarioPath(input),
      scenarioTasks: [buildAdHocScenarioTask({ goal, targetUrl })],
    })
  }

  return loadScenarioTaskListFromPath(scenarioPath).catch((error) => {
    if (!looksLikeUrl(scenarioPath)) {
      throw error
    }

    return {
      scenarioPath: buildAdHocScenarioPath({ goal, targetUrl: scenarioPath }),
      scenarioTasks: [buildAdHocScenarioTask({ goal, targetUrl: scenarioPath })],
    }
  })
}

function nextScenario(run: ActiveRunRecord): ParsedScenarioTask | undefined {
  if (run.nextScenarioIndex >= run.scenarioTasks.length) return
  const task = run.scenarioTasks[run.nextScenarioIndex]
  run.nextScenarioIndex += 1
  return task
}

async function executeWorker(run: ActiveRunRecord, worker: WorkerExecutionState) {
  const sessionName = buildWorkerSessionName(run.runId, worker.id)
  const issueReporter = (input: ReportIssueInput) => {
    reportIssue({
      ...input,
      runId: run.runId,
      workerId: input.workerId?.trim() || worker.id,
    })
  }

  worker.status = "running"
  worker.passed = 0
  worker.failed = 0
  worker.skipped = 0
  worker.elapsedMs = 0
  worker.progressText = "starting"
  worker.issues = []
  worker.scenario = undefined
  worker.sessionName = sessionName

  emit({
    runId: run.runId,
    scenarioId: run.scenarioPath,
    workerId: worker.id,
    event: "run.started",
    payload: {
      worker,
      scenario: run.scenarioPath,
      runId: run.runId,
      parallelism: run.parallelism,
      failurePolicy: run.failurePolicy,
    },
  })

  try {
    const runtime = run as unknown as WorkerRuntimeContext
    runtime.modelApiKey = run.modelApiKey

    while (!run.cancelToken.cancelled) {
      const task = nextScenario(run)
      if (!task) break

      worker.scenario = `${task.fileName} - ${task.title}`
      worker.progressText = `running ${worker.scenario}`
      await executeWorkerScenario(runtime, worker, task, sessionName, emit, issueReporter)

      if (run.failurePolicy === "fail-fast" && run.issues.length > 0) {
        run.cancelToken.cancelled = true
        run.runStopReason = "fail-fast"
      }
    }

    if (run.cancelToken.cancelled && run.runStopReason !== "manual") {
      worker.status = "error"
      worker.progressText = run.runStopReason === "fail-fast" ? "stopped by fail-fast" : "cancelled"
    } else {
      worker.status = worker.failed === 0 ? "done" : "error"
      worker.progressText = "completed"
    }

    emit({
      runId: run.runId,
      scenarioId: run.scenarioPath,
      workerId: worker.id,
      event: "summary",
      payload: {
        workerSummary: issueSummariesFromWorkers([worker])[0],
      },
    })
  } catch (error) {
    worker.status = "error"
    worker.progressText = "error"
    worker.failed = (worker.failed ?? 0) + 1
    emit({
      runId: run.runId,
      scenarioId: run.scenarioPath,
      workerId: worker.id,
      event: "error",
      payload: {
        reason: error instanceof Error ? error.message : "Worker execution failed.",
        workerId: worker.id,
      },
    })
  } finally {
    await closeWorkerSession(sessionName).catch(() => undefined)
    worker.scenario = undefined
  }
}

function applyRunStart(run: ActiveRunRecord, initialWorkers: WorkerExecutionState[]) {
  run.workers = initialWorkers
  emit({
    runId: run.runId,
    scenarioId: run.scenarioPath,
    event: "run.started",
    payload: {
      run,
      workers: run.workers,
      totalScenarios: run.totalScenarios,
      parallelism: run.parallelism,
      failurePolicy: run.failurePolicy,
      totalSteps: run.totalSteps,
    },
  })
}

function applyRunFinished(run: ActiveRunRecord) {
  if (run.runStopReason === "manual") {
    run.status = "cancelled"
  } else if (run.runStopReason === "fail-fast" || run.issues.length > 0) {
    run.status = run.status === "cancelled" ? "cancelled" : "error"
  } else {
    run.status = run.status === "cancelled" ? "cancelled" : "finished"
  }

  run.endedAt = Date.now()
  run.workerSummaries = issueSummariesFromWorkers(run.workers)
  emit({
    runId: run.runId,
    scenarioId: run.scenarioPath,
    event: "run.finished",
    payload: {
      run,
      summary: buildAggregate(run),
    },
  })
}

export function subscribe(listener: OrchestratorEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function startWorkers(input: StartRunInput): Promise<RunSpawnResult> {
  const { scenarioPath, scenarioTasks } = await resolveScenarioSource(input)

  const parallelism = clampParallelism(input.parallelism ?? DEFAULT_PARALLELISM)
  const runId = newRunId()
  const stepTimeoutMs = clampTimeoutMs(input.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, DEFAULT_STEP_TIMEOUT_MS)
  const scenarioTimeoutMs = clampTimeoutMs(
    input.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
    DEFAULT_SCENARIO_TIMEOUT_MS,
  )
  const failurePolicy = input.failurePolicy ?? DEFAULT_FAILURE_POLICY
  const screenshotPolicy = input.screenshotPolicy ?? "on-failure"
  const labels = input.labels ?? []
  const totalSteps = scenarioTasks.reduce((count, task) => count + task.steps.length, 0)
  const modelId = input.modelId
  const modelApiKey = await resolveModelApiKey(modelId)

  const runRecord: ActiveRunRecord = {
    runId,
    scenarioPath,
    startedAt: Date.now(),
    status: "running",
    parallelism,
    failurePolicy,
    stepTimeoutMs,
    scenarioTimeoutMs,
    screenshotPolicy,
    labels,
    modelId,
    modelApiKey,
    workers: makeWorkers(Math.min(parallelism, Math.max(1, scenarioTasks.length))),
    workerSummaries: [],
    issues: [],
    scenarioTasks,
    nextScenarioIndex: 0,
    totalScenarios: scenarioTasks.length,
    stepsCompleted: 0,
    totalSteps,
    cancelToken: { cancelled: false },
    queuedMs: 0,
    runStopReason: undefined,
  }

  runs.set(runId, runRecord)

  const startedAt = Date.now()
  applyRunStart(runRecord, runRecord.workers)
  runRecord.queuedMs = Date.now() - startedAt

  const workers = runRecord.workers.slice(0)
  void Promise.all(workers.map((worker) => executeWorker(runRecord, worker))).finally(() => {
    if (runRecord.status === "running" || runRecord.status === "cancelled") {
      applyRunFinished(runRecord)
    }
  })

  return {
    runId,
    status: "running",
    scenarioPath,
    parallelism,
    failurePolicy,
    startedAt: toIso(runRecord.startedAt),
  }
}

export function getRun(runId: string): RunRecordSummary | null {
  const run = runs.get(runId)
  if (!run) return null

  return {
    runId: run.runId,
    scenarioPath: run.scenarioPath,
    startedAt: toIso(run.startedAt),
    endedAt: run.endedAt ? toIso(run.endedAt) : undefined,
    parallelism: run.parallelism,
    status: run.status,
    failurePolicy: run.failurePolicy,
    issues: [...run.issues],
    workers: [...run.workers],
    stepsCompleted: run.stepsCompleted,
    totalSteps: run.totalSteps,
  }
}

export function listRuns(): RunRecordSummary[] {
  return Array.from(runs.values()).map((run) => ({
    runId: run.runId,
    scenarioPath: run.scenarioPath,
    startedAt: toIso(run.startedAt),
    endedAt: run.endedAt ? toIso(run.endedAt) : undefined,
    parallelism: run.parallelism,
    status: run.status,
    failurePolicy: run.failurePolicy,
    issues: [...run.issues],
    workers: [...run.workers],
    stepsCompleted: run.stepsCompleted,
    totalSteps: run.totalSteps,
  }))
}

export function checkRun(runId: string): RunCheckResult {
  const run = runs.get(runId)
  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  return {
    runId,
    status: run.status,
    scenarioPath: run.scenarioPath,
    parallelism: run.parallelism,
    workerSummaries: issueSummariesFromWorkers(run.workers),
    aggregate: run.status === "running" ? null : buildAggregate(run),
    updatedAt: toIso(run.endedAt ?? Date.now()),
  }
}

export function cancelRun(runId: string): RunRecordSummary {
  const run = runs.get(runId)
  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  run.cancelToken.cancelled = true
  run.runStopReason = "manual"
  if (run.status === "running") {
    run.status = "cancelled"
    run.workers.forEach((worker) => {
      if (worker.status === "running") {
        worker.status = "error"
        worker.progressText = "cancelled"
      }
    })
  }

  emit({
    runId,
    scenarioId: run.scenarioPath,
    event: "run.cancelled",
    payload: {
      runId,
      status: run.status,
    },
  })

  return {
    runId: run.runId,
    scenarioPath: run.scenarioPath,
    startedAt: toIso(run.startedAt),
    endedAt: toIso(run.endedAt ?? Date.now()),
    parallelism: run.parallelism,
    status: run.status,
    failurePolicy: run.failurePolicy,
    issues: [...run.issues],
    workers: [...run.workers],
    stepsCompleted: run.stepsCompleted,
    totalSteps: run.totalSteps,
  }
}

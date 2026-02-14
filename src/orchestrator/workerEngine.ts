import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core"
import { Type } from "@sinclair/typebox"
import { getModel, type Model } from "@mariozechner/pi-ai"
import {
  closeSession,
  runAgentBrowserStep,
  buildSessionName,
  type AgentBrowserResult,
  type StepAction,
} from "./agentBrowser"
import type { RunEvent, ReportIssueInput, OrchestratorIssue, WorkerExecutionState } from "./contracts"
import type { ParsedScenarioTask, ParsedScenarioStep } from "./scenarioParser"

type RunEventEmitter = (event: Omit<RunEvent, "timestamp">) => void
type IssueRecorder = (input: ReportIssueInput) => void

const WORKER_AGENT_MAX_TOOL_CALLS = 20
const WORKER_AGENT_MAX_TURNS = 8
const DEFAULT_WORKER_MODEL = "openai:gpt-5-mini"

export interface WorkerRuntimeContext {
  runId: string
  scenarioPath: string
  stepTimeoutMs: number
  scenarioTimeoutMs: number
  screenshotPolicy: "always" | "on-failure" | "never"
  failurePolicy: "continue-all" | "fail-fast"
  modelId?: string
  modelApiKey?: string
  runStopReason?: "manual" | "fail-fast"
  cancelToken: { cancelled: boolean }
  issues: OrchestratorIssue[]
  stepsCompleted: number
}

type StepResult = "passed" | "failed" | "skipped"

type RunEvidence = {
  screenshot?: string
  snapshotRef?: string
  url?: string
  title?: string
  agentBrowserLogs?: string
}

type StepOutcome = {
  status: StepResult
  evidence?: RunEvidence
}

type WorkerContext = {
  run: WorkerRuntimeContext
  worker: WorkerExecutionState
  task: ParsedScenarioTask
  sessionName: string
  emit: RunEventEmitter
  reportIssue: IssueRecorder
  stepIndexRef: { value: number }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return
  return Number.isFinite(value) ? value : undefined
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return
  const values = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
  return values.length > 0 ? values : undefined
}

function scenarioLabel(task: ParsedScenarioTask) {
  return `${task.fileName} - ${task.title}`
}

function normalizeModelCandidate(value: string): { provider: string; model: string } {
  const trimmed = value.trim()
  const idx = trimmed.indexOf(":")
  if (idx > 0) {
    return {
      provider: trimmed.slice(0, idx).trim().toLowerCase(),
      model: trimmed.slice(idx + 1).trim(),
    }
  }
  return { provider: "openai", model: trimmed }
}

function resolveModelFromId(modelId: string | undefined): Model<any> | undefined {
  const candidate = modelId && modelId.trim().length > 0 ? modelId : DEFAULT_WORKER_MODEL
  const normalized = normalizeModelCandidate(candidate)
  if (!normalized.model) return
  try {
    return getModel(normalized.provider as never, normalized.model as never) as Model<any> | undefined
  } catch {
    return
  }
}

function shouldStopRun(run: WorkerRuntimeContext): boolean {
  if (run.cancelToken.cancelled) {
    return true
  }
  if (run.failurePolicy !== "fail-fast") {
    return false
  }
  return run.issues.length > 0
}

function emitStepStart(ctx: WorkerContext, stepIndex: number, label: string, raw: string, startedAt: number) {
  ctx.emit({
    runId: ctx.run.runId,
    scenarioId: ctx.task.scenarioId,
    workerId: ctx.worker.id,
    stepIndex,
    attempt: 1,
    event: "step.start",
    payload: {
      sessionName: ctx.sessionName,
      label,
      startedAt: new Date(startedAt).toISOString(),
      raw,
    },
  })
}

function emitStepComplete(
  ctx: WorkerContext,
  stepIndex: number,
  label: string,
  status: StepResult,
  elapsedMs: number,
  message?: string,
  evidence?: RunEvidence,
) {
  ctx.emit({
    runId: ctx.run.runId,
    scenarioId: ctx.task.scenarioId,
    workerId: ctx.worker.id,
    stepIndex,
    attempt: 1,
    event: "step.complete",
    payload: {
      sessionName: ctx.sessionName,
      label,
      status,
      elapsedMs,
      evidence,
      message,
    },
  })
}

function buildRunEvidence(result: AgentBrowserResult): RunEvidence {
  const evidence: RunEvidence = {}
  if (result.evidence?.screenshot) {
    evidence.screenshot = result.evidence.screenshot
  }
  if (result.evidence?.snapshotRef) {
    evidence.snapshotRef = result.evidence.snapshotRef
  }
  if (result.evidence?.url) {
    evidence.url = result.evidence.url
  }
  if (result.evidence?.title) {
    evidence.title = result.evidence.title
  }
  if (result.evidence?.agentBrowserLogs) {
    evidence.agentBrowserLogs = result.evidence.agentBrowserLogs
  }
  return evidence
}

function maybeScreenshotForEvidence(ctx: WorkerContext, step: ParsedScenarioStep): Promise<RunEvidence | undefined> {
  if (ctx.run.screenshotPolicy === "never") return Promise.resolve(undefined)

  return runAgentBrowserStep(ctx.sessionName, "screenshot", {
    id: `${step.id}-evidence`,
    kind: "screenshot",
    label: "screenshot",
    raw: "screenshot",
  }).then((result) => (result.ok ? { screenshot: result.output } : undefined))
}

function reportStepFailureIssue(ctx: WorkerContext, stepLabel: string, expected: string, actual: string, evidence?: RunEvidence, isAssertion = false) {
  ctx.reportIssue({
    runId: ctx.run.runId,
    workerId: ctx.worker.id,
    scenario: ctx.task.scenarioId,
    title: `${isAssertion ? "Assertion" : "Action"} failed: ${stepLabel}`,
    severity: isAssertion ? "medium" : "high",
    area: `${ctx.task.scenarioId} > ${ctx.task.title}`,
    expected,
    actual,
    steps: [ctx.task.scenarioId],
    evidence,
    confidence: isAssertion ? 0.87 : 0.74,
  })
}

function browserStepFromInput(action: StepAction, args: Record<string, unknown>): ParsedScenarioStep {
  const target = asString(args.target)
  const value = asString(args.value)
  const durationMs = asOptionalNumber(args.durationMs)
  const waitMode = asString(args.waitMode)
  const raw = [action, target, value].filter(Boolean).join(" ").trim()

  if (action === "open") {
    return { id: "", kind: "open", label: `open ${target ?? ""}`, raw: raw || "open", target, options: { target: target ?? "" } }
  }

  if (action === "click") {
    return { id: "", kind: "click", label: `click ${target ?? ""}`, raw: raw || "click", target, options: { target: target ?? "" } }
  }

  if (action === "fill") {
    return {
      id: "",
      kind: "fill",
      label: `fill ${target ?? ""}`,
      raw: raw || "fill",
      target,
      value,
      options: { target: target ?? "", value: value ?? "" },
    }
  }

  if (action === "type") {
    return {
      id: "",
      kind: "type",
      label: `type ${target ?? ""}`,
      raw: raw || "type",
      target,
      value,
      options: { target: target ?? "", value: value ?? "" },
    }
  }

  if (action === "press") {
    return {
      id: "",
      kind: "press",
      label: `press ${target ?? ""}`,
      raw: raw || "press",
      target,
      options: { target: target ?? "" },
    }
  }

  if (action === "select") {
    return {
      id: "",
      kind: "select",
      label: `select ${value ?? ""}`,
      raw: raw || "select",
      target,
      value,
      options: { target: target ?? "", value: value ?? "" },
    }
  }

  if (action === "check") {
    return {
      id: "",
      kind: "check",
      label: `check ${target ?? ""}`,
      raw: raw || "check",
      target,
      options: { target: target ?? "" },
    }
  }

  if (action === "wait") {
    return {
      id: "",
      kind: "wait",
      label: `wait ${durationMs ? `${durationMs}ms` : "state"}`,
      raw: raw || "wait",
      target: asString(args.url),
      value,
      durationMs,
      options: {
        waitMode: (waitMode as ParsedScenarioStep["options"] extends { waitMode?: infer T } ? T : undefined),
        durationMs,
      },
    }
  }

  if (action === "get_text") {
    return {
      id: "",
      kind: "get_text",
      label: `get text ${target ?? ""}`,
      raw: raw || "get text",
      target,
      options: { target: target ?? "" },
    }
  }

  if (action === "get_url") {
    return { id: "", kind: "get_url", label: "get url", raw: "get url", options: {} }
  }

  if (action === "get_title") {
    return { id: "", kind: "get_title", label: "get title", raw: "get title", options: {} }
  }

  if (action === "snapshot") {
    return { id: "", kind: "snapshot", label: "snapshot", raw: "snapshot", options: {} }
  }

  return {
    id: "",
    kind: "screenshot",
    label: "screenshot",
    raw: "screenshot",
    options: {},
  }
}

function toToolResult(content: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: content }],
    details,
  }
}

function createBrowserTools(ctx: WorkerContext, deadline: number): AgentTool[] {
  const runBrowserAction = async (action: StepAction, params: Record<string, unknown>): Promise<{
    ok: boolean
    status: StepResult
    evidence?: RunEvidence
    output?: string
  }> => {
    if (shouldStopRun(ctx.run)) {
      return { ok: false, status: "failed", output: "run cancelled" }
    }

    if (Date.now() > deadline) {
      const message = `Scenario timed out after ${ctx.run.scenarioTimeoutMs}ms`
      reportStepFailureIssue(ctx, "scenario timeout", `Finish scenario within ${ctx.run.scenarioTimeoutMs}ms`, message, undefined, false)
      ctx.run.cancelToken.cancelled = true
      ctx.run.runStopReason = "fail-fast"
      return { ok: false, status: "failed", output: message }
    }

    const step: ParsedScenarioStep = browserStepFromInput(action, params)
    const stepIndex = ctx.stepIndexRef.value
    ctx.stepIndexRef.value += 1
    const startedAt = Date.now()
    emitStepStart(ctx, stepIndex, step.label, step.raw, startedAt)

    const result = await runAgentBrowserStep(ctx.sessionName, action, step, ctx.run.stepTimeoutMs)
    const elapsedMs = Date.now() - startedAt
    const status: StepResult = result.ok ? "passed" : "failed"
    const evidence = buildRunEvidence(result)
    ctx.run.stepsCompleted += 1
    ctx.worker.elapsedMs = elapsedMs

    if (status === "passed") {
      ctx.worker.passed = (ctx.worker.passed ?? 0) + 1
    } else {
      ctx.worker.failed = (ctx.worker.failed ?? 0) + 1
      if (ctx.run.failurePolicy === "fail-fast") {
        ctx.run.cancelToken.cancelled = true
        ctx.run.runStopReason = "fail-fast"
      }
      if (ctx.run.screenshotPolicy !== "never") {
        const screenshot = await maybeScreenshotForEvidence(ctx, step)
        if (screenshot) evidence.screenshot = screenshot.screenshot
      }
      reportStepFailureIssue(
        ctx,
        step.label,
        `Browser action "${action}" to execute`,
        result.text || result.output || "browser command failed",
        evidence,
        false,
      )
    }

    emitStepComplete(ctx, stepIndex, step.label, status, elapsedMs, result.text || result.output, evidence)
    return {
      ok: result.ok,
      status,
      evidence,
      output: result.output,
      ...(status === "passed" ? {} : { output: result.output }),
    }
  }

  const runBrowserTool = (name: string, action: StepAction, description: string, parameters: ReturnType<typeof Type.Object>) =>
    ({
      name,
      label: `${name} browser action`,
      description,
      parameters,
      execute: async (_toolCallId, params) => {
        const result = await runBrowserAction(action, asObject(params) ?? {})
        if (!result.ok) {
          return toToolResult(`${action} failed: ${result.output || "tool failed"}`, {
            action,
            status: result.status,
            output: result.output,
          })
        }
        return toToolResult(`${action} completed`, {
          action,
          status: result.status,
          output: result.output,
        })
      },
    }) as AgentTool

  const doneTool: AgentTool = {
    name: "done",
    label: "Mark scenario complete",
    description: "Mark scenario as complete and stop the worker loop.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([Type.Literal("passed"), Type.Literal("partial"), Type.Literal("failed")]),
      ),
      summary: Type.Optional(Type.String()),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
      execute: async (_toolCallId, params) => {
      return toToolResult(`Scenario marked complete.`, {
        done: true,
        status: asString(asObject(params)?.status) ?? "passed",
        summary: asString(asObject(params)?.summary) ?? "",
        confidence: asOptionalNumber(asObject(params)?.confidence) ?? 1,
      })
    },
  }

  const reportIssueTool: AgentTool = {
    name: "report_issue",
    label: "Report test issue",
    description: "Record an issue found while executing the scenario.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      severity: Type.Union([Type.Literal("blocker"), Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
      area: Type.String({ minLength: 1 }),
      expected: Type.String({ minLength: 1 }),
      actual: Type.String({ minLength: 1 }),
      steps: Type.Array(Type.String()),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      evidence: Type.Optional(
        Type.Object({
          screenshot: Type.Optional(Type.String()),
          snapshotRef: Type.Optional(Type.String()),
          agentBrowserLogs: Type.Optional(Type.String()),
          url: Type.Optional(Type.String()),
          title: Type.Optional(Type.String()),
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const input = asObject(params)
      const title = asString(input?.title) ?? "Issue"
      const evidence = asObject(input?.evidence)
      const issueConfidence = asOptionalNumber(input?.confidence)
      ctx.reportIssue({
        runId: ctx.run.runId,
        workerId: ctx.worker.id,
        scenario: ctx.task.scenarioId,
        title,
        severity: (asString(input?.severity) as ReportIssueInput["severity"]) ?? "medium",
        area: asString(input?.area) ?? `${ctx.task.scenarioId} > ${ctx.task.title}`,
        expected: asString(input?.expected) ?? "",
        actual: asString(input?.actual) ?? "",
        steps: asOptionalStringArray(input?.steps) ?? [],
        evidence: {
          screenshot: asString(evidence?.screenshot),
          snapshotRef: asString(evidence?.snapshotRef),
          agentBrowserLogs: asString(evidence?.agentBrowserLogs),
          url: asString(evidence?.url),
          title: asString(evidence?.title),
        },
        confidence: issueConfidence === undefined ? 0.7 : issueConfidence,
      })
      ctx.worker.failed = (ctx.worker.failed ?? 0) + 1
      if (ctx.run.failurePolicy === "fail-fast") {
        ctx.run.cancelToken.cancelled = true
        ctx.run.runStopReason = "fail-fast"
      }
      return toToolResult(`Issue "${title}" reported.`, {
        issue: title,
      })
    },
  }

  return [
    runBrowserTool("open", "open", "Open a URL in the browser.", Type.Object({ target: Type.String() })),
    runBrowserTool("click", "click", "Click a target.", Type.Object({ target: Type.String() })),
    runBrowserTool("fill", "fill", "Fill a target field.", Type.Object({ target: Type.String(), value: Type.String() })),
    runBrowserTool("type", "type", "Type into a target field.", Type.Object({ target: Type.String(), value: Type.String() })),
    runBrowserTool("press", "press", "Press a key or shortcut.", Type.Object({ target: Type.String() })),
    runBrowserTool("select", "select", "Select an option from dropdown.", Type.Object({ target: Type.String(), value: Type.String() })),
    runBrowserTool("check", "check", "Check a selector/text condition.", Type.Object({ target: Type.String() })),
    runBrowserTool("wait", "wait", "Wait for a period or state.", Type.Object({
      durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
      waitForUrl: Type.Optional(Type.String()),
      waitMode: Type.Optional(Type.Union([Type.Literal("url"), Type.Literal("networkidle"), Type.Literal("duration"), Type.Literal("selector")])),
    })),
    runBrowserTool("get_text", "get_text", "Read text.", Type.Object({ target: Type.Optional(Type.String()) })),
    runBrowserTool("get_url", "get_url", "Read current URL.", Type.Object({})),
    runBrowserTool("get_title", "get_title", "Read current title.", Type.Object({})),
    runBrowserTool("snapshot", "snapshot", "Capture snapshot metadata.", Type.Object({})),
    runBrowserTool("screenshot", "screenshot", "Capture a screenshot.", Type.Object({})),
    doneTool,
    reportIssueTool,
  ]
}

async function executeDeterministicScenario(ctx: WorkerContext): Promise<void> {
  if (ctx.task.steps.length === 0) {
    return
  }

  const scenarioDeadline = Date.now() + ctx.run.scenarioTimeoutMs
  ctx.worker.scenario = scenarioLabel(ctx.task)

  for (let stepIndex = 0; stepIndex < ctx.task.steps.length; stepIndex += 1) {
    if (shouldStopRun(ctx.run) || Date.now() > scenarioDeadline) {
      const message = `Scenario timed out after ${ctx.run.scenarioTimeoutMs}ms`
      ctx.reportIssue({
        runId: ctx.run.runId,
        workerId: ctx.worker.id,
        scenario: ctx.task.scenarioId,
        title: `Scenario timeout: ${scenarioLabel(ctx.task)}`,
        severity: "high",
        area: scenarioLabel(ctx.task),
        expected: `Finish scenario within ${ctx.run.scenarioTimeoutMs}ms`,
        actual: message,
        steps: [ctx.task.scenarioId],
        confidence: 0.9,
      })
      ctx.worker.failed = (ctx.worker.failed ?? 0) + 1
      if (ctx.run.failurePolicy === "fail-fast") {
        ctx.run.cancelToken.cancelled = true
        ctx.run.runStopReason = "fail-fast"
      }
      return
    }

    const step = ctx.task.steps[stepIndex]
    const stepOutcome = await executeDeterministicAction(ctx, step, stepIndex)

    if (stepOutcome.status === "passed") {
      ctx.worker.passed = (ctx.worker.passed ?? 0) + 1
    } else if (stepOutcome.status === "skipped") {
      ctx.worker.skipped = (ctx.worker.skipped ?? 0) + 1
    } else {
      ctx.worker.failed = (ctx.worker.failed ?? 0) + 1
      if (ctx.run.failurePolicy === "fail-fast") {
        ctx.run.cancelToken.cancelled = true
        ctx.run.runStopReason = "fail-fast"
      }
    }

    ctx.run.stepsCompleted += 1
    if (ctx.run.cancelToken.cancelled) {
      return
    }
  }
}

async function executeDeterministicAction(ctx: WorkerContext, step: ParsedScenarioStep, stepIndex: number): Promise<StepOutcome> {
  emitStepStart(ctx, stepIndex, step.label, step.raw, Date.now())
  const resolveBrowserAction = (inputStepKind: ParsedScenarioStep["kind"]): StepAction => {
    if (
      inputStepKind === "assert_url_contains" ||
      inputStepKind === "assert_text_visible" ||
      inputStepKind === "assert_title_contains" ||
      inputStepKind === "assert_selector_visible"
    ) {
      return "check"
    }
    return inputStepKind as StepAction
  }

  const runDirect = async (action: StepAction, candidateStep: ParsedScenarioStep) =>
    runAgentBrowserStep(ctx.sessionName, action, candidateStep, ctx.run.stepTimeoutMs)

  if (step.kind === "unsupported") {
    const outcome: StepOutcome = { status: "skipped" }
    emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, step.note ?? "unsupported step")
    return outcome
  }

  if (step.kind === "assert_url_contains") {
    const assertion = asString(step.value)
    if (!assertion) return { status: "failed" }

    const urlResult = await runDirect("get_url", { ...step, kind: "get_url" })
    if (!urlResult.ok) {
      const outcome: StepOutcome = { status: "failed" }
      emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, "Could not read browser URL", { agentBrowserLogs: urlResult.output })
      return outcome
    }

    const url = urlResult.text.trim()
    if (url.includes(assertion)) {
      const outcome: StepOutcome = { status: "passed" }
      emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `URL assertion passed: "${assertion}" in "${url}"`)
      return outcome
    }

    const screenshot = await maybeScreenshotForEvidence(ctx, step)
    reportStepFailureIssue(
      ctx,
      step.label,
      `Page URL to contain "${assertion}"`,
      url ? `Observed URL "${url}"` : "No URL available",
      screenshot,
      true,
    )
    const outcome: StepOutcome = { status: "failed", evidence: screenshot }
    emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `URL assertion failed: expected "${assertion}", got "${url}"`, screenshot)
    return outcome
  }

  if (step.kind === "assert_title_contains") {
    const assertion = asString(step.value)
    if (!assertion) return { status: "failed" }

    const titleResult = await runDirect("get_title", { ...step, kind: "get_title" })
    if (!titleResult.ok) {
      const outcome: StepOutcome = { status: "failed" }
      emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, "Could not read page title", {
        agentBrowserLogs: titleResult.output,
      })
      return outcome
    }

    const title = titleResult.text.trim()
    if (title.includes(assertion)) {
      const outcome: StepOutcome = { status: "passed" }
      emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `Title assertion passed: "${assertion}"`)
      return outcome
    }

    const screenshot = await maybeScreenshotForEvidence(ctx, step)
    reportStepFailureIssue(
      ctx,
      step.label,
      `Page title to contain "${assertion}"`,
      title ? `Observed title "${title}"` : "No title available",
      screenshot,
      true,
    )
    const outcome: StepOutcome = { status: "failed", evidence: screenshot }
    emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `Title assertion failed: expected "${assertion}", got "${title}"`, screenshot)
    return outcome
  }

  if (step.kind === "assert_text_visible" || step.kind === "assert_selector_visible") {
    const checkTarget = step.target || step.value
    if (!checkTarget) return { status: "failed" }

    const checkResult = await runDirect("check", { ...step, kind: "check", target: checkTarget })
    if (!checkResult.ok) {
      const screenshot = await maybeScreenshotForEvidence(ctx, step)
      reportStepFailureIssue(
        ctx,
        step.label,
        `Element "${checkTarget}" to be visible`,
        `Check failed: ${checkResult.text || "not visible"}`,
        screenshot,
        true,
      )
      const outcome: StepOutcome = { status: "failed", evidence: screenshot }
      emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `Failed to assert visible target "${checkTarget}"`, screenshot)
      return outcome
    }

    const outcome: StepOutcome = { status: "passed" }
    emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, `Element "${checkTarget}" is visible`)
    return outcome
  }

  const result = await runDirect(resolveBrowserAction(step.kind), step)
  if (!result.ok) {
    const outcome: StepOutcome = { status: "failed" }
    const screenshot = await maybeScreenshotForEvidence(ctx, step)
    if (step.kind !== "get_url" && step.kind !== "get_title" && step.kind !== "get_text" && step.kind !== "snapshot") {
      reportStepFailureIssue(
        ctx,
        step.label,
        `Browser action "${step.kind}" to execute`,
        result.text || result.output || "browser command failed",
        screenshot,
        false,
      )
      outcome.evidence = screenshot
    }
    emitStepComplete(
      ctx,
      stepIndex,
      step.label,
      outcome.status,
      0,
      result.text || result.output || "Browser action failed",
      outcome.evidence,
    )
    return outcome
  }

  const outcome: StepOutcome = { status: "passed" }
  emitStepComplete(ctx, stepIndex, step.label, outcome.status, 0, result.text || `Executed ${step.label}`)
  return outcome
}

async function executeAgenticScenario(ctx: WorkerContext): Promise<boolean> {
  const deadline = Date.now() + ctx.run.scenarioTimeoutMs
  const tools = createBrowserTools(ctx, deadline)
  const model = resolveModelFromId(ctx.run.modelId)
  if (!model) return false

  const steps = ctx.task.steps.map((step) => `- ${step.raw}`).join("\n")
  const systemPrompt = [
    `You are Worker ${ctx.worker.id} executing scenario "${scenarioLabel(ctx.task)}".`,
    `Scenario source: ${ctx.task.fileName}.`,
    "Use browser tools to execute the scenario as best as you can.",
    "You have limited freedom: you may insert small stabilization steps (wait/screenshot) when they reduce flake.",
    "Call report_issue when you see a real defect with evidence and confidence.",
    "When complete (or unable to complete), call done.",
    "",
    "Scenario steps:",
    steps || "- (no explicit steps)",
  ].join("\n")

  let done = false
  let turned = 0
  let toolCalls = 0
  let toolLimitReached = false
  let abortReason: string | undefined

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "off",
      tools,
    },
    getApiKey: () => ctx.run.modelApiKey,
  })

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "turn_start") {
      turned += 1
      if (turned > WORKER_AGENT_MAX_TURNS) {
        toolLimitReached = true
        abortReason = "worker reached max turns"
        agent.abort()
      }
    }

    if (event.type === "tool_execution_start") {
      toolCalls += 1
      if (toolCalls > WORKER_AGENT_MAX_TOOL_CALLS) {
        toolLimitReached = true
        abortReason = "worker reached max tool calls"
        agent.abort()
      }
    }

    if (event.type === "tool_execution_end" && event.toolName === "done") {
      const result = asObject((event as { result?: unknown }).result)
      done = true
      if (result?.status === "failed") {
        done = false
      }
    }

    if (event.type === "tool_execution_end" && event.isError) {
      abortReason = "tool execution error"
      if (!agent) return
      agent.abort()
    }
  })

  try {
    await agent.prompt(systemPrompt)
    await agent.waitForIdle()
  } finally {
    unsubscribe()
  }

  if (Date.now() > deadline) {
    abortReason = `scenario timed out after ${ctx.run.scenarioTimeoutMs}ms`
  }

  if (toolLimitReached) {
    ctx.reportIssue({
      runId: ctx.run.runId,
      workerId: ctx.worker.id,
      scenario: ctx.task.scenarioId,
      title: `Worker reached guardrails for ${scenarioLabel(ctx.task)}`,
      severity: "medium",
      area: scenarioLabel(ctx.task),
      expected: "Complete scenario within tool/turn budgets.",
      actual: abortReason ?? "agentic guardrail triggered",
      steps: [ctx.task.scenarioId],
      confidence: 0.91,
    })
  }

  if (!done) {
    reportStepFailureIssue(
      ctx,
      scenarioLabel(ctx.task),
      "Scenario completion",
      `done not called: ${abortReason ?? "unknown"}`,
      undefined,
      true,
    )
  }

  return done
}

export async function executeWorkerScenario(
  run: WorkerRuntimeContext,
  worker: WorkerExecutionState,
  task: ParsedScenarioTask,
  sessionName: string,
  emit: RunEventEmitter,
  reportIssue: IssueRecorder,
) {
  const ctx: WorkerContext = {
    run,
    worker,
    task,
    sessionName,
    emit,
    reportIssue,
    stepIndexRef: { value: run.stepsCompleted },
  }
  const model = resolveModelFromId(run.modelId)
  if (!model || !run.modelApiKey) {
    await executeDeterministicScenario(ctx)
    return
  }

  try {
    const handled = await executeAgenticScenario(ctx)
    if (!handled) {
      await executeDeterministicScenario(ctx)
    }
  } catch (_error) {
    await executeDeterministicScenario(ctx)
  }
}

export function buildWorkerSessionName(runId: string, workerId: string): string {
  return buildSessionName(runId, workerId)
}

export async function closeWorkerSession(sessionName: string): Promise<void> {
  await closeSession(sessionName).catch(() => undefined)
}

export function scenarioLabelForTask(task: ParsedScenarioTask) {
  return scenarioLabel(task)
}

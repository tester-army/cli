export type WorkerStatus = "idle" | "running" | "done" | "error";

export type FailurePolicy = "continue-all" | "fail-fast";

export interface OrchestratorEvidence {
  screenshot?: string;
  snapshotRef?: string;
  agentBrowserLogs?: string;
  url?: string;
  title?: string;
}

export interface OrchestratorIssue {
  title: string;
  severity: "blocker" | "high" | "medium" | "low";
  area: string;
  expected: string;
  actual: string;
  steps: string[];
  evidence: OrchestratorEvidence;
  confidence: number;
}

export interface WorkerSummary {
  workerId: string;
  scenario: string;
  passed: number;
  failed: number;
  skipped: number;
  timeMs: number;
  issues: OrchestratorIssue[];
  safetyNotes: string[];
  status: "passed" | "failed" | "cancelled";
}

export interface RunAggregate {
  runId: string;
  startedAt: string;
  endedAt: string;
  status: "passed" | "partial" | "failed" | "error";
  scenariosTotal: number;
  passed: number;
  failed: number;
  skipped: number;
  issues: OrchestratorIssue[];
  workerSummaries: WorkerSummary[];
  timing: {
    wallClockMs: number;
    queuedMs: number;
    executionMs: number;
    overheadMs: number;
  };
}

export interface RunEvent {
  runId: string;
  scenarioId: string;
  workerId?: string;
  stepIndex?: number;
  attempt?: number;
  event:
    | "step.start"
    | "step.complete"
    | "issue"
    | "summary"
    | "error"
    | "timeout"
    | "retry"
    | "run.started"
    | "run.finished"
    | "run.cancelled";
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface WorkerExecutionState {
  id: string;
  name: string;
  scenario?: string;
  sessionName?: string;
  status: WorkerStatus;
  progressText?: string;
  elapsedMs?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  issues?: OrchestratorIssue[];
}

export interface RunRecordSummary {
  runId: string;
  scenarioPath: string;
  startedAt: string;
  endedAt?: string;
  parallelism: number;
  status: "running" | "finished" | "cancelled" | "error";
  failurePolicy: FailurePolicy;
  workers: WorkerExecutionState[];
  issues: OrchestratorIssue[];
  stepsCompleted: number;
  totalSteps: number;
}

export interface ReportIssueInput {
  runId?: string;
  workerId?: string;
  scenario?: string;
  title: string;
  severity: OrchestratorIssue["severity"];
  area: string;
  expected: string;
  actual: string;
  steps: string[];
  evidence?: OrchestratorEvidence;
  confidence: number;
}

export interface StartRunInput {
  scenarioPath?: string;
  goal?: string;
  targetUrl?: string;
  parallelism?: number;
  failurePolicy?: FailurePolicy;
  stepTimeoutMs?: number;
  scenarioTimeoutMs?: number;
  screenshotPolicy?: "always" | "on-failure" | "never";
  labels?: string[];
  modelId?: string;
}

export interface RunSpawnResult {
  runId: string;
  status: "running";
  scenarioPath: string;
  parallelism: number;
  failurePolicy: FailurePolicy;
  startedAt: string;
}

export interface RunCheckResult {
  runId: string;
  status: "running" | "finished" | "cancelled" | "error";
  scenarioPath: string;
  parallelism: number;
  workerSummaries: WorkerSummary[];
  aggregate: RunAggregate | null;
  updatedAt: string;
}

export type OrchestratorEventListener = (event: RunEvent) => void;

export interface RunToolResponse {
  ok: boolean;
  message: string;
  data?: RunSpawnResult | RunCheckResult | RunRecordSummary[];
}

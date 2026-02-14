export type RouteType = "home" | "session" | "results";
export type WorkerStatus = "idle" | "running" | "done" | "error";
export type RunState = "ready" | "running" | "finished";

export interface WorkerCard {
  id: string;
  name: string;
  scenario?: string;
  status: WorkerStatus;
  progressText?: string;
  elapsedMs?: number;
}

export interface Message {
  id: string;
  at: string;
  kind: "user" | "assistant" | "tool" | "system";
  text: string;
  meta?: Record<string, unknown>;
}

export interface TuiState {
  route: RouteType;
  runState: RunState;
  runBusy: boolean;
  commandMode: boolean;
  commandBuffer: string;
  commandSuggestions: string[];
  messages: Message[];
  workers: WorkerCard[];
  toasts: string[];
}

export interface UiEvent {
  id: string;
  at: string;
  type: "command.started" | "command.finished" | "log.appended" | "worker.status" | "error" | "toast";
  payload: Record<string, unknown>;
}

export interface RunLifecycle {
  runId: string;
  scenario: string;
  startedAt: string;
  parallel: number;
  status: "running" | "done" | "error";
}

import { createMemo, createSignal } from "solid-js";
import { dispatchCommand, commandAutosuggest } from "../commands/dispatch";
import { parseCommand } from "../commands/parse";
import type { CommandResult } from "../contracts/commands";
import type { Message, RouteType, TuiState, WorkerCard } from "../contracts/state";
import { runMockSimulation } from "../dev-sim/simulation";

interface AppState {
  route: () => RouteType;
  runState: () => TuiState["runState"];
  runBusy: () => boolean;
  commandMode: () => boolean;
  commandBuffer: () => string;
  commandSuggestions: () => string[];
  messages: () => Message[];
  workers: () => WorkerCard[];
  toasts: () => string[];
}

interface AppActions {
  updateCommandBuffer: (value: string) => void;
  submitCommand: () => Promise<CommandResult>;
  cancelCommand: () => void;
  clearCommandBuffer: () => void;
  selectSuggestion: (command: string) => void;
  seedWelcome: () => void;
}

const message = (text: string, kind: Message["kind"] = "assistant"): Message => ({
  id: `msg-${Math.random().toString(16).slice(2, 10)}`,
  at: new Date().toISOString(),
  kind,
  text,
});

interface AppStoreOptions {
  onExit: () => void | Promise<void>;
}

export function createAppStore({
  onExit,
}: AppStoreOptions): { state: AppState; actions: AppActions } {
  const [route, setRoute] = createSignal<RouteType>("home");
  const [runState, setRunState] = createSignal<TuiState["runState"]>("ready");
  const [runBusy, setRunBusy] = createSignal(false);
  const [commandMode, setCommandMode] = createSignal(false);
  const [commandBuffer, setCommandBuffer] = createSignal("");
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [workers, setWorkers] = createSignal<WorkerCard[]>([
    { id: "worker-template", name: "Worker 1", status: "idle" },
  ]);
  const [toasts, setToasts] = createSignal<string[]>([]);

  const latestSuggestions = createMemo(() => commandAutosuggest(commandBuffer()));

  const state: AppState = {
    route,
    runState,
    runBusy,
    commandMode,
    commandBuffer,
    commandSuggestions: latestSuggestions,
    messages,
    workers,
    toasts,
  };

  const appendMessage = (text: string, kind: Message["kind"] = "assistant") => {
    setMessages((prev) => [...prev, message(text, kind)]);
  };

  const clearMessages = () => setMessages([]);

  const pushToast = (text: string) =>
    setToasts((prev) => [...prev.slice(-3), text]);

  const applyWorkerUpdate = (next: WorkerCard[]) => {
    setWorkers(next);
  };

  const run: AppActions["submitCommand"] = async () => {
    const raw = commandBuffer();

    if (!raw.trim()) {
      return { ok: false, message: "No command provided" };
    }

    setRunBusy(true);
    setCommandMode(false);

    const parsed = parseCommand(raw);
    if (parsed.name !== "unknown" && parsed.name !== "run") {
      appendMessage(raw, "user");
      const result = await dispatchCommand(
        { rawInput: raw },
        {
          appendText: appendMessage,
          startRun,
          clearMessages,
          setRoute: (nextRoute: RouteType) => setRoute(nextRoute),
          exit: () => {
            pushToast("exit requested");
            void onExit();
          },
        },
      );

      appendMessage(`/${parsed.name}: ${result.result.message}`, result.result.ok ? "system" : "assistant");
      setRunBusy(false);
      setCommandBuffer("");
      return result.result;
    }

    if (parsed.name === "run") {
      appendMessage(raw, "user");
      appendMessage(`Starting run with ${parsed.rawArgs || "default scenario"}`, "system");
      await startRun(parsed.rawArgs);
      appendMessage("Run command dispatched.", "system");
    } else {
      appendMessage(`Unknown command: ${raw}. Use /help`, "assistant");
      setRunBusy(false);
      setCommandBuffer("");
      return { ok: false, message: "Unknown command" };
    }

    setRunBusy(false);
    setCommandBuffer("");
    return { ok: true, message: "command executed" };
  };

  async function startRun(rawArgs: string) {
    setRunState("running");
    setRoute("session");
    setWorkers((prev) =>
      prev.map((worker, idx) => ({
        ...worker,
        status: idx === 0 ? "running" : "idle",
      })),
    );

    await runMockSimulation(rawArgs, {
      appendMessage: (msg: Message) => setMessages((prev) => [...prev, msg]),
      setWorkers: applyWorkerUpdate,
      setRunState: setRunState,
    });
  }

  return {
    state,
    actions: {
      updateCommandBuffer(value) {
        setCommandBuffer(value);
        const shouldOpen = value.startsWith("/");
        setCommandMode(shouldOpen);
      },
      submitCommand: run,
      cancelCommand() {
        setCommandMode(false);
      },
      clearCommandBuffer() {
        setCommandBuffer("");
        setCommandMode(false);
      },
      selectSuggestion(command) {
        setCommandBuffer(command);
      },
      seedWelcome() {
        setRoute("home");
        setMessages([
          {
            id: `welcome-${Date.now()}`,
            at: new Date().toISOString(),
            kind: "assistant",
            text: "TesterArmy CLI TUI initialized. Type /help to see available commands.",
          },
          {
            id: `hint-${Date.now()}`,
            at: new Date().toISOString(),
            kind: "system",
            text: "Tip: Type /run <path> [--parallel 2] to simulate a test execution.",
          },
        ]);
        setToasts(["Session ready"]);
      },
    },
  };
}

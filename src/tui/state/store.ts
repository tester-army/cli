import { createMemo, createSignal } from "solid-js";
import { dispatchCommand, commandAutosuggest } from "../commands/dispatch";
import { parseCommand } from "../commands/parse";
import type { CommandResult } from "../contracts/commands";
import type { Message, RouteType, TuiState, WorkerCard } from "../contracts/state";
import { runMockSimulation } from "../dev-sim/simulation";
import { chatWithPiMono, defaultModelChoice, listAvailableModels } from "../agent/piMono";

interface AppState {
  route: () => RouteType;
  runState: () => TuiState["runState"];
  runBusy: () => boolean;
  commandMode: () => boolean;
  commandBuffer: () => string;
  commandSuggestions: () => string[];
  activeModel: () => string;
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
  const [activeModel, setActiveModel] = createSignal("openai:gpt-5-mini");

  const latestSuggestions = createMemo(() => commandAutosuggest(commandBuffer()));

  const state: AppState = {
    route,
    runState,
    runBusy,
    commandMode,
    commandBuffer,
    commandSuggestions: latestSuggestions,
    activeModel,
    messages,
    workers,
    toasts,
  };

  const appendMessage = (text: string, kind: Message["kind"] = "assistant"): string => {
    const next = message(text, kind);
    setMessages((prev) => [...prev, next]);
    return next.id;
  };

  const appendStreamingAssistantMessage = () => appendMessage("", "assistant");

  const appendChunkToMessage = (messageId: string, chunk: string) => {
    if (!chunk) {
      return;
    }

    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === messageId ? { ...entry, text: `${entry.text}${chunk}` } : entry,
      ),
    );
  };

  const replaceMessageText = (messageId: string, text: string) => {
    setMessages((prev) =>
      prev.map((entry) => (entry.id === messageId ? { ...entry, text } : entry)),
    );
  };

  const clearMessages = () => setMessages([]);

  const pushToast = (text: string) =>
    setToasts((prev) => [...prev.slice(-3), text]);

  const applyWorkerUpdate = (next: WorkerCard[]) => {
    setWorkers(next);
  };

  const syncModelState = async () => {
    const choices = await listAvailableModels().catch(() => []);
    const defaults = choices.map((entry) => entry.id);
    const current = activeModel();

    if (choices.length > 0 && !defaults.includes(current)) {
      const fallback = current.includes(":") ? current : `openai:${current}`;
      const match = choices.find((choice) => choice.id === fallback);
      setActiveModel((match ?? choices[0]).id);
    }

    if (choices.length === 0) return;
    const configured = await defaultModelChoice();
    const found = choices.find((choice) => choice.id === configured.id);
    if (!current || !found) {
      setActiveModel(configured.id);
    }
  };

  const run: AppActions["submitCommand"] = async () => {
    const raw = commandBuffer();

    if (!raw.trim()) {
      return { ok: false, message: "No command provided" };
    }

    setCommandBuffer("");

    setRunBusy(true);
    setCommandMode(false);

    try {
      const parsed = parseCommand(raw);
      const isSlash = raw.trim().startsWith("/");
      if (parsed.name !== "unknown" && parsed.name !== "run") {
        appendMessage(raw, "user");
        const result = await dispatchCommand(
          { rawInput: raw },
          {
            appendText: (text, kind) => {
              appendMessage(text, kind);
            },
            startRun,
            clearMessages,
            setRoute: (nextRoute: RouteType) => setRoute(nextRoute),
            getActiveModel: () => activeModel(),
            setActiveModel: (nextModel) => setActiveModel(nextModel),
            listModels: async () => {
              const choices = await listAvailableModels().catch(() => []);
              return choices;
            },
            exit: () => {
              pushToast("exit requested");
              void onExit();
            },
          },
        );

        appendMessage(`/${parsed.name}: ${result.result.message}`, result.result.ok ? "system" : "assistant");
        return result.result;
      }

      if (parsed.name === "run") {
        appendMessage(raw, "user");
        appendMessage(`Starting run with ${parsed.rawArgs || "default scenario"}`, "system");
        await startRun(parsed.rawArgs);
        appendMessage("Run command dispatched.", "system");
      } else {
        const history = messages().flatMap((entry) => {
          if (entry.kind !== "user" && entry.kind !== "assistant") {
            return [];
          }
          return [{ role: entry.kind, content: entry.text }];
        });

        appendMessage(raw, "user");
        setRoute("session");
        if (isSlash) {
          appendMessage(`Unknown command: ${raw}. Use /help`, "assistant");
          return { ok: false, message: "Unknown command" };
        }

        const assistantMessageId = appendStreamingAssistantMessage();
        const result = await chatWithPiMono({
          modelId: activeModel(),
          prompt: raw,
          history,
          onChunk: (chunk) => {
            appendChunkToMessage(assistantMessageId, chunk);
          },
          onStatus: (status) => {
            pushToast(status);
          },
        });

        if (!result.ok) {
          replaceMessageText(assistantMessageId, result.message);
          return { ok: false, message: result.message };
        }

        replaceMessageText(assistantMessageId, result.text);
      }

      return { ok: true, message: "command executed" };
    } catch (error) {
      appendMessage(`Command failed: ${error instanceof Error ? error.message : "Unexpected error"}`, "assistant");
      return { ok: false, message: error instanceof Error ? error.message : "Unexpected error" };
    } finally {
      setRunBusy(false);
    }
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
            text: "Type /help to see available commands.",
          },
        ]);
        setToasts([]);
        void syncModelState();
      },
    },
  };
}

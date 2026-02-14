import { createMemo, createSignal } from "solid-js";
import { dispatchCommand, commandAutosuggest } from "../commands/dispatch";
import { parseCommand } from "../commands/parse";
import type { CommandResult } from "../contracts/commands";
import type { Message, RouteType, TuiState, WorkerCard } from "../contracts/state";
import { runMockSimulation } from "../dev-sim/simulation";
import {
  chatWithPiMono,
  defaultModelChoice,
  getPersistedActiveModel,
  listAvailableModels,
  listAvailableProviders,
  loginWithProvider,
  persistActiveModel,
  type ModelChoice,
  type ProviderChoice,
} from "../agent/piMono";

interface AppState {
  route: () => RouteType;
  runState: () => TuiState["runState"];
  runBusy: () => boolean;
  commandMode: () => boolean;
  commandBuffer: () => string;
  commandSuggestions: () => string[];
  activeModel: () => string;
  activeProvider: () => string;
  messages: () => Message[];
  workers: () => WorkerCard[];
  toasts: () => string[];
}

interface AppActions {
  updateCommandBuffer: (value: string) => void;
  submitCommand: (text?: string) => Promise<CommandResult>;
  cancelCommand: () => void;
  clearCommandBuffer: () => void;
  selectSuggestion: (command: string) => void;
  seedWelcome: () => void;
  pushToast: (text: string) => void;
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

function normalizeProviderFromModel(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed.includes(":")) {
    return "openai";
  }

  const [provider] = trimmed.split(":");
  return provider.trim().toLowerCase();
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
  const [activeProvider, setActiveProvider] = createSignal("openai");
  const [availableModels, setAvailableModels] = createSignal<ModelChoice[]>([]);
  const [availableProviders, setAvailableProviders] = createSignal<string[]>([]);
  const [availableOAuthProviders, setAvailableOAuthProviders] = createSignal<string[]>([]);

  const latestSuggestions = createMemo(() =>
    commandAutosuggest(
      commandBuffer(),
      availableProviders(),
      availableModels().map((model) => model.id),
      availableOAuthProviders(),
    ),
  );

  const state: AppState = {
    route,
    runState,
    runBusy,
    commandMode,
    commandBuffer,
    commandSuggestions: latestSuggestions,
    activeModel,
    activeProvider,
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

  const setActiveModelAndProvider = (nextModel: string) => {
    setActiveModel(nextModel);
    setActiveProvider(normalizeProviderFromModel(nextModel));
    void persistActiveModel(nextModel);
  };

  const pushToast = (text: string) =>
    setToasts((prev) => [...prev.slice(-3), text]);

  const applyWorkerUpdate = (next: WorkerCard[]) => {
    setWorkers(next);
  };

  const syncModelState = async () => {
    const choices = await listAvailableModels().catch(() => []);
    setAvailableModels(choices);
    const providerSet = new Set<string>();
    choices.forEach((entry) => {
      providerSet.add(entry.provider);
    });
    setAvailableProviders(Array.from(providerSet).sort());

    const defaults = choices.map((entry) => entry.id);
    const current = activeModel();

    if (choices.length > 0 && !defaults.includes(current)) {
      const fallback = current.includes(":") ? current : `openai:${current}`;
      const match = choices.find((choice) => choice.id === fallback);
      setActiveModelAndProvider((match ?? choices[0]).id);
    }

    if (choices.length === 0) return;

    const configured = await defaultModelChoice();
    const found = choices.find((choice) => choice.id === configured.id);
    if (!current || !found) {
      setActiveModelAndProvider(configured.id);
    }
  };

  const syncProviderState = async () => {
    const providers = await listAvailableProviders().catch(() => []);
    const names = providers.map((provider) => provider.id);
    const oauthNames = providers.filter((provider) => provider.requiresOAuth).map((provider) => provider.id);

    setAvailableProviders((current) => {
      const merged = new Set(current);
      names.forEach((name) => merged.add(name));
      return Array.from(merged).sort();
    });
    setAvailableOAuthProviders((current) => {
      const merged = new Set(current);
      oauthNames.forEach((name) => merged.add(name));
      return Array.from(merged).sort();
    });
  };

  const refreshCatalog = async () => {
    await syncModelState();
    await syncProviderState();
  };

  const hydrateActiveModel = async () => {
    const restoredModel = await getPersistedActiveModel().catch(() => undefined);
    if (restoredModel) {
      setActiveModelAndProvider(restoredModel);
    }
    await refreshCatalog();
  };

  const run: AppActions["submitCommand"] = async (rawInput) => {
    const raw = typeof rawInput === "string" ? rawInput.trim() : commandBuffer();

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
        setRoute("session");
        appendMessage(raw, "user");
        const result = await dispatchCommand(
          { rawInput: raw },
          {
            appendText: (text: string, kind: "assistant" | "system") => {
              appendMessage(text, kind);
            },
            startRun,
            clearMessages,
            setRoute: (nextRoute: RouteType) => setRoute(nextRoute),
            getActiveModel: () => activeModel(),
            setActiveModel: (nextModel) => setActiveModelAndProvider(nextModel),
            listModels: async () => {
              const choices = availableModels();
              if (choices.length > 0) {
                return choices;
              }
              return listAvailableModels().catch(() => []);
            },
            listProviders: async () => {
              const providers = await listAvailableProviders().catch(() => []);
              setAvailableProviders((current) => {
                const merged = new Set(current);
                providers.forEach((provider) => merged.add(provider.id));
                return Array.from(merged).sort();
              });
              setAvailableOAuthProviders((current) => {
                const merged = new Set(current);
                providers.forEach((provider) => {
                  if (provider.requiresOAuth) {
                    merged.add(provider.id);
                  }
                });
                return Array.from(merged).sort();
              });
              return providers;
            },
            loginProvider: async (provider: string) => {
              const result = await loginWithProvider(provider, {
                onAuth(info: { url: string; instructions?: string }) {
                  appendMessage(`Open this URL in a browser:\n${info.url}`, "assistant");
                  if (info.instructions) {
                    appendMessage(info.instructions, "assistant");
                  }
                },
                onProgress(message: string) {
                  pushToast(message);
                },
              });

              await refreshCatalog();
              return result;
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

      await refreshCatalog();
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
        setCommandBuffer("");
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
        setMessages([]);
        setToasts([]);
        void hydrateActiveModel();
      },
      pushToast,
    },
  };
}

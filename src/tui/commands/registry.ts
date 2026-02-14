import type { CommandResult } from "../contracts/commands";
import type { ModelChoice, ProviderChoice } from "../agent/piMono";

export type CommandContext = {
  appendText: (text: string, kind: "assistant" | "system") => void;
  clearMessages: () => void;
  setRoute: (route: "home" | "session" | "results") => void;
  exit: () => void;
  getActiveModel: () => string;
  setActiveModel: (modelId: string) => void;
  listModels: () => Promise<ModelChoice[]>;
  listProviders: () => Promise<ProviderChoice[]>;
  loginProvider: (provider: string) => Promise<{ ok: boolean; message: string }>;
};

function summarizeModels(models: ModelChoice[]): string {
  const byProvider = models.reduce((groups, item) => {
    const existing = groups.get(item.provider) ?? [];
    existing.push(item.label);
    groups.set(item.provider, existing);
    return groups;
  }, new Map<string, string[]>());

  return Array.from(byProvider, ([provider, providerModels]) => `${provider}: ${providerModels.join(", ")}`).join(
    "\n",
  );
}

function parseArg(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface CommandHandler {
  name: string;
  description: string;
  run: (ctx: CommandContext, args: string) => Promise<CommandResult>;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const commandRegistry: Record<string, CommandHandler> = {
  generate: {
    name: "generate",
    description: "Generate scenario candidates from source path",
    run: async (ctx, args) => {
      await delay(80);
      ctx.appendText(`Generate requested for ${args || "./"}.`, "assistant");
      return { ok: true, message: "Generation is scaffolded in phase 1." };
    },
  },
  config: {
    name: "config",
    description: "Open and edit configuration",
    run: async (ctx) => {
      await delay(20);
      ctx.setRoute("results");
      ctx.appendText("Config is not editable yet in phase 1.", "assistant");
      return { ok: true, message: "Config screen is a placeholder." };
    },
  },
  clear: {
    name: "clear",
    description: "Clear message stream",
    run: async (ctx) => {
      ctx.clearMessages();
      return { ok: true, message: "Message stream cleared." };
    },
  },
  new: {
    name: "new",
    description: "Start a new chat session",
    run: async (ctx) => {
      ctx.clearMessages();
      ctx.setRoute("session");
      return { ok: true, message: "New chat started." };
    },
  },
  help: {
    name: "help",
    description: "Show command list",
    run: async (ctx) => {
      const help = [
        "/generate [path]",
        "/provider",
        "/provider <provider>",
        "/providers",
        "/model [provider:model]",
        "/models",
        "/login [provider]",
        "/config",
        "/clear",
        "/new",
        "/quit",
        "/help",
      ].join("\n");
      ctx.appendText(`Commands:\n${help}`, "assistant");
      return { ok: true, message: "Help displayed." };
    },
  },
  models: {
    name: "models",
    description: "List available AI models from the registry",
    run: async (ctx, args) => {
      const models = await ctx.listModels();
      if (models.length === 0) {
        ctx.appendText("No model options were found.", "assistant");
        return { ok: false, message: "No model options found." };
      }
      const requested = parseArg(args);
      const normalizedRequested = parseArg(requested);
      const filtered =
        normalizedRequested === "" ? models : models.filter((item) => item.provider === normalizedRequested);

      if (normalizedRequested && filtered.length === 0) {
        const requestedProvider = requested ? requested : "the selected provider";
        ctx.appendText(`No models found for provider "${requestedProvider}".`, "assistant");
        return { ok: false, message: `No models for provider ${requestedProvider}` };
      }

      const output = [
        `Active model: ${ctx.getActiveModel()}`,
        summarizeModels(filtered.length ? filtered : models),
      ].join("\n");

      ctx.appendText(output, "assistant");
      return { ok: true, message: "Models listed." };
    },
  },
  provider: {
    name: "provider",
    description: "Switch active provider",
    run: async (ctx, args) => {
      const requested = parseArg(args);
      if (!requested) {
        const active = parseArg(ctx.getActiveModel()).split(":")[0];
        ctx.appendText(`Active provider: ${active}`, "assistant");
        return { ok: true, message: "Active provider shown." };
      }

      const providers = await ctx.listProviders();
      const requestedProvider = providers.find((provider) => provider.id === requested);
      if (!requestedProvider) {
        const options = providers.map((provider) => provider.id).join(", ");
        ctx.appendText(`Unknown provider "${requested}". Available: ${options}`, "assistant");
        return { ok: false, message: `Unknown provider ${requested}` };
      }

      const models = await ctx.listModels();
      const firstModel = models.find((entry) => entry.provider === requested) ?? models[0];
      if (!firstModel) {
        ctx.appendText(`No models found for provider "${requested}".`, "assistant");
        return { ok: false, message: `No models for ${requested}` };
      }

      ctx.setActiveModel(firstModel.id);
      const authStatus =
        requestedProvider.requiresOAuth && !requestedProvider.authenticated
          ? ` (OAuth not linked yet; run /login ${requestedProvider.id} when using this provider)`
          : "";
      ctx.appendText(`Active provider set to ${requested}. Default model: ${firstModel.id}${authStatus}`, "assistant");
      return { ok: true, message: "Active provider updated." };
    },
  },
  providers: {
    name: "providers",
    description: "List available AI providers",
    run: async (ctx) => {
      const providers = await ctx.listProviders();
      if (providers.length === 0) {
        ctx.appendText("No providers found.", "assistant");
        return { ok: false, message: "No providers found." };
      }

      const activeProvider = parseArg(ctx.getActiveModel()).split(":")[0];
      const lines = providers.map((provider) => {
        const oauthTag = provider.requiresOAuth ? (provider.authenticated ? "oauth✓" : "oauth✗") : "api-key";
        const current = provider.id === activeProvider ? " (active)" : "";
        return `${provider.id} (${oauthTag}) — ${provider.name}${current}`;
      });

      ctx.appendText(`Active provider: ${activeProvider}\n${lines.join("\n")}`, "assistant");
      return { ok: true, message: "Providers listed." };
    },
  },
  login: {
    name: "login",
    description: "Start OAuth login flow for a provider",
    run: async (ctx, args) => {
      const requested = parseArg(args);
      if (!requested) {
        ctx.appendText("Usage: /login <provider>\nUse /providers to see OAuth-capable providers.", "assistant");
        return { ok: false, message: "Missing provider argument." };
      }

      const providers = await ctx.listProviders();
      const requestedProvider = providers.find((provider) => provider.id === requested);
      if (!requestedProvider) {
        const options = providers.map((provider) => provider.id).join(", ");
        ctx.appendText(`Unknown provider "${requested}". Available: ${options}`, "assistant");
        return { ok: false, message: `Unknown provider ${requested}` };
      }

      if (!requestedProvider.requiresOAuth) {
        ctx.appendText(
          `Provider "${requestedProvider.id}" does not require OAuth. Set API key via environment or config path.`,
          "assistant",
        );
        return { ok: false, message: `Provider ${requestedProvider.id} not OAuth-based` };
      }

      const result = await ctx.loginProvider(requestedProvider.id);
      if (result.ok) {
        const choices = await ctx.listModels();
        const firstModel = choices.find((entry) => entry.provider === requestedProvider.id);
        if (firstModel) {
          ctx.setActiveModel(firstModel.id);
        }
        ctx.appendText(result.message, "assistant");
        return { ok: true, message: "Login complete." };
      }

      ctx.appendText(result.message, "assistant");
      return { ok: false, message: result.message };
    },
  },
  model: {
    name: "model",
    description: "Set the active AI model",
    run: async (ctx, args) => {
      const requested = args.trim();
      const requestedLower = requested.toLowerCase();

      if (!requested) {
        const message = `Active model: ${ctx.getActiveModel()}`;
        ctx.appendText(message, "assistant");
        return { ok: true, message: "Active model shown." };
      }

      const normalized = requestedLower.includes(":") ? requestedLower : `openai:${requestedLower}`;
      const choices = await ctx.listModels();
      let match = choices.find((entry) => {
        const id = entry.id.toLowerCase();
        const label = entry.label.toLowerCase();
        return id === normalized || id === requestedLower || label === requestedLower;
      });

      if (!match && !requestedLower.includes(":")) {
        const modelMatches = choices.filter((entry) => entry.model.toLowerCase() === requestedLower);
        if (modelMatches.length === 1) {
          match = modelMatches[0];
        } else if (modelMatches.length > 1) {
          const options = modelMatches.map((entry) => entry.id).join(", ");
          ctx.appendText(`Model "${requested}" is ambiguous. Try one of: ${options}`, "assistant");
          return { ok: false, message: `Model not found: ${requested}` };
        }
      }

      if (!match) {
        const suggestion = choices.slice(0, 4).map((entry) => entry.label).join(", ");
        ctx.appendText(`Model "${requested}" is not available. Try one of: ${suggestion}`, "assistant");
        return { ok: false, message: `Model not found: ${requested}` };
      }

      if (!requestedLower.includes(":") && match.provider !== "openai") {
        const duplicateProviderMatch = choices.filter((entry) => entry.model.toLowerCase() === requestedLower);
        if (duplicateProviderMatch.length > 1) {
          const options = duplicateProviderMatch.map((entry) => entry.id).join(", ");
          ctx.appendText(`Model "${requested}" is ambiguous. Try one of: ${options}`, "assistant");
          return { ok: false, message: `Model not found: ${requested}` };
        }
      }

      if (match.provider !== "openai") {
        ctx.appendText(`Model "${requested}" was matched to ${match.id}.`, "assistant");
      }

      ctx.setActiveModel(match.id);
      ctx.appendText(`Active model set to ${match.id}`, "assistant");
      return { ok: true, message: "Active model updated." };
    },
  },
  quit: {
    name: "quit",
    description: "Exit app",
    run: async (ctx) => {
      await delay(20);
      ctx.appendText("Goodbye", "assistant");
      ctx.exit();
      return { ok: true, message: "Exiting" };
    },
  },
  unknown: {
    name: "unknown",
    description: "Unknown",
    run: async (_ctx, raw) => {
      return { ok: false, message: `Unknown command ${raw}` };
    },
  },
};

import type { CommandResult } from "../contracts/commands";
import type { ModelChoice } from "../agent/piMono";

export type CommandContext = {
  appendText: (text: string, kind: "assistant" | "system") => void;
  startRun: (args: string) => Promise<void>;
  clearMessages: () => void;
  setRoute: (route: "home" | "session" | "results") => void;
  exit: () => void;
  getActiveModel: () => string;
  setActiveModel: (modelId: string) => void;
  listModels: () => Promise<ModelChoice[]>;
};

export interface CommandHandler {
  name: string;
  description: string;
  run: (ctx: CommandContext, args: string) => Promise<CommandResult>;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const commandRegistry: Record<string, CommandHandler> = {
  run: {
    name: "run",
    description: "Run a scenario file or directory",
    run: async (ctx, args) => {
      await ctx.startRun(args);
      ctx.setRoute("session");
      return { ok: true, message: `Run started with args: ${args || "<no args>"}` };
    },
  },
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
  help: {
    name: "help",
    description: "Show command list",
    run: async (ctx) => {
      const help = [
        "/run <path> [--parallel n]",
        "/generate <path>",
        "/model <provider:model>",
        "/models",
        "/config",
        "/clear",
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
    run: async (ctx) => {
      const models = await ctx.listModels();
      if (models.length === 0) {
        ctx.appendText("No model options were found.", "assistant");
        return { ok: false, message: "No model options found." };
      }

      const byProvider = models.reduce((groups, item) => {
        const existing = groups.get(item.provider) ?? [];
        existing.push(item.label);
        groups.set(item.provider, existing);
        return groups;
      }, new Map<string, string[]>());

      const output = [
        `Active model: ${ctx.getActiveModel()}`,
        ...Array.from(byProvider, ([provider, providerModels]) => {
          return `${provider}: ${providerModels.join(", ")}`;
        }),
      ].join("\n");

      ctx.appendText(output, "assistant");
      return { ok: true, message: "Models listed." };
    },
  },
  model: {
    name: "model",
    description: "Set the active AI model",
    run: async (ctx, args) => {
      const requested = args.trim();

      if (!requested) {
        const message = `Active model: ${ctx.getActiveModel()}. Use /model <provider:model>`;
        ctx.appendText(message, "assistant");
        return { ok: true, message: "Active model shown." };
      }

      const normalized = requested.includes(":") ? requested : `openai:${requested}`;
      const choices = await ctx.listModels();
      const match = choices.find(
        (entry) => entry.id === normalized || entry.id === requested || entry.label === requested,
      );

      if (!match) {
        const suggestion = choices.slice(0, 4).map((entry) => entry.label).join(", ");
        ctx.appendText(`Model "${requested}" is not available. Try one of: ${suggestion}`, "assistant");
        return { ok: false, message: `Model not found: ${requested}` };
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

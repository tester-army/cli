import type { CommandResult } from "../contracts/commands";

export type CommandContext = {
  appendText: (text: string, kind: "assistant" | "system") => void;
  startRun: (args: string) => Promise<void>;
  clearMessages: () => void;
  setRoute: (route: "home" | "session" | "results") => void;
  exit: () => void;
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
        "/config",
        "/clear",
        "/quit",
        "/help",
      ].join("\n");
      ctx.appendText(`Commands:\n${help}`, "assistant");
      return { ok: true, message: "Help displayed." };
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


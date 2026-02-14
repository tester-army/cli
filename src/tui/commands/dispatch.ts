import { commandSuggestions } from "./parse";
import { parseCommand } from "./parse";
import { commandRegistry } from "./registry";
import type { CommandResult, ParsedCommand } from "../contracts/commands";
import type { ModelChoice, ProviderChoice } from "../agent/piMono";

export interface DispatchInput {
  rawInput: string;
}

export interface DispatchContext {
  appendText: (text: string, kind: "assistant" | "system") => void;
  clearMessages: () => void;
  setRoute: (route: "home" | "session" | "results") => void;
  exit: () => void;
  getActiveModel: () => string;
  setActiveModel: (modelId: string) => void;
  listModels: () => Promise<ModelChoice[]>;
  listProviders: () => Promise<ProviderChoice[]>;
  loginProvider: (provider: string) => Promise<{ ok: boolean; message: string }>;
}

export interface DispatchResult {
  parsed: ParsedCommand;
  result: CommandResult;
}

export async function dispatchCommand(
  input: DispatchInput,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const parsed = parseCommand(input.rawInput);

  const handler = commandRegistry[parsed.name] ?? commandRegistry.unknown;
  const result = await handler.run(
    {
      appendText: ctx.appendText,
      clearMessages: ctx.clearMessages,
      setRoute: ctx.setRoute,
      exit: ctx.exit,
      getActiveModel: ctx.getActiveModel,
      setActiveModel: ctx.setActiveModel,
      listModels: ctx.listModels,
      listProviders: ctx.listProviders,
      loginProvider: ctx.loginProvider,
    },
    parsed.rawArgs,
  );

  if (!result.ok && parsed.name === "unknown") {
    ctx.appendText(`Unknown command: ${parsed.raw}`, "assistant");
  }

  return { parsed, result };
}

export function commandAutosuggest(
  input: string,
  providers: string[] = [],
  models: string[] = [],
  oauthProviders: string[] = [],
): string[] {
  return commandSuggestions(input, { providers, models, oauthProviders });
}

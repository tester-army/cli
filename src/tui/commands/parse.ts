import type { ParsedCommand, TuiCommandName } from "../contracts/commands";

const KNOWN_COMMANDS = new Set<TuiCommandName>([
  "run",
  "generate",
  "config",
  "quit",
  "help",
  "clear",
  "provider",
  "providers",
  "login",
  "model",
  "models",
]);

type SuggestionOptions = {
  providers?: string[];
  models?: string[];
  oauthProviders?: string[];
};

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return {
      raw: trimmed,
      name: "unknown",
      args: [],
      rawArgs: "",
    };
  }

  const raw = trimmed.slice(1);
  const [rawCommand, ...argTokens] = raw.split(/\s+/);
  const command = rawCommand?.toLowerCase();
  const name = command && KNOWN_COMMANDS.has(command as TuiCommandName)
    ? (command as TuiCommandName)
    : "unknown";

  const args: ParsedCommand["args"] = [];
  for (let i = 0; i < argTokens.length; i += 1) {
    const token = argTokens[i];
    if (token.startsWith("--")) {
      const next = argTokens[i + 1];
      if (next && !next.startsWith("--")) {
        args.push({ name: token.replace(/^--/, ""), value: next });
        i += 1;
      } else {
        args.push({ name: token.replace(/^--/, ""), value: "true" });
      }
    } else {
      args.push({ name: "arg", value: token });
    }
  }

  return {
    raw: trimmed,
    name,
    args,
    rawArgs: argTokens.join(" "),
  };
}

export function commandSuggestions(filter: string, options: SuggestionOptions = {}): string[] {
  const all = [...KNOWN_COMMANDS].map((cmd) => `/${cmd}`);
  const providers = options.providers ?? [];
  const models = options.models ?? [];
  const oauthProviders = options.oauthProviders ?? [];
  const needle = filter.trim().toLowerCase();

  if (!needle.startsWith("/")) {
    return all;
  }

  const withoutSlash = needle.slice(1);
  const [commandName, ...args] = withoutSlash.split(/\s+/);
  const rest = withoutSlash.slice(commandName?.length ?? 0).trim();

  if (commandName === "provider") {
    if (!providers.length) {
      return ["/providers"];
    }

    return providers
      .filter((provider) => provider.toLowerCase().includes(rest))
      .map((provider) => `/provider ${provider}`);
  }

  if (commandName === "model" && models.length > 0) {
    if (!rest) {
      return models.slice(0, 8).map((model) => `/model ${model}`);
    }

    return models
      .filter((model) => model.toLowerCase().includes(rest))
      .map((model) => `/model ${model}`)
      .slice(0, 8);
  }

  if (commandName === "login") {
    const candidates = oauthProviders.length > 0 ? oauthProviders : providers;

    if (!candidates.length) {
      return ["/providers"];
    }

    return candidates
      .filter((provider) => provider.toLowerCase().includes(rest))
      .map((provider) => `/login ${provider}`)
      .slice(0, 8);
  }

  const match = withoutSlash;
  if (!match) {
    return all;
  }

  return all.filter((command) => command.includes(match));
}

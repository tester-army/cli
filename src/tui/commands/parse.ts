import type { ParsedCommand, TuiCommandName } from "../contracts/commands";

const KNOWN_COMMANDS = new Set<TuiCommandName>([
  "run",
  "generate",
  "config",
  "quit",
  "help",
  "clear",
]);

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
  const [command, ...argTokens] = raw.split(/\s+/);
  const name = KNOWN_COMMANDS.has(command as TuiCommandName)
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

export function commandSuggestions(filter: string): string[] {
  const all = [...KNOWN_COMMANDS].map((cmd) => `/${cmd}`);
  const needle = filter.trim().toLowerCase();

  if (!needle.startsWith("/")) {
    return all;
  }

  const match = needle.slice(1);
  if (!match) {
    return all;
  }

  return all.filter((command) => command.includes(match));
}

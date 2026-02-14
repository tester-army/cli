export type TuiCommandName = "run" | "generate" | "config" | "quit" | "help" | "clear" | "model" | "models";

export interface CommandArg {
  name: string;
  value: string;
}

export interface ParsedCommand {
  raw: string;
  name: TuiCommandName | "unknown";
  args: CommandArg[];
  rawArgs: string;
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

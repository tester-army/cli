export type TuiCommandName =
  | "generate"
  | "config"
  | "quit"
  | "help"
  | "clear"
  | "new"
  | "model"
  | "models"
  | "provider"
  | "providers"
  | "login";

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

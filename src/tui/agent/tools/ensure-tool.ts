import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

function getWorkspaceNodeModulesBin(): string {
  return `${process.cwd()}/node_modules/.bin`
}

function commandExists(command: string): boolean {
  try {
    const result = spawnSync(command, ["--version"], {
      stdio: "ignore",
    })
    return result.error === undefined && result.status === 0
  } catch {
    return false
  }
}

export function ensureTool(tool: "fd" | "rg", _silent = false): Promise<string | undefined> {
  const local = join(getWorkspaceNodeModulesBin(), tool)
  if (existsSync(local) && commandExists(local)) {
    return Promise.resolve(local)
  }

  if (commandExists(tool)) {
    return Promise.resolve(tool)
  }

  return Promise.resolve(undefined)
}


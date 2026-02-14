import { type RunBashToolOptions, createRunBashTool } from "./run-bash"
import type { ToolInvocationPolicy } from "../types"
import { createEditTool, editTool } from "./edit"
import { createFindTool, findTool } from "./find"
import { createGrepTool, grepTool } from "./grep"
import { createLsTool, lsTool } from "./ls"
import { createReadTool, readTool } from "./read"
import { createWriteTool, writeTool } from "./write"

export type { ToolInvocationPolicy } from "../types"
export { createRunBashTool, type RunBashToolOptions }
export { createReadTool, readTool }
export { createEditTool, editTool }
export { createWriteTool, writeTool }
export { createLsTool, lsTool }
export { createFindTool, findTool }
export { createGrepTool, grepTool }

export function buildOrchestratorTools(
  getAbortSignal: () => AbortSignal | undefined,
  shouldAllowTool?: ToolInvocationPolicy,
  onStatus?: (status: string) => void,
) {
  return [
    createRunBashTool({ getAbortSignal, shouldAllowTool, onStatus }),
    createReadTool(process.cwd()),
    createEditTool(process.cwd()),
    createWriteTool(process.cwd()),
    createLsTool(process.cwd()),
    createFindTool(process.cwd()),
    createGrepTool(process.cwd()),
  ]
}

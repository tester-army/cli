import { constants } from "node:fs"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises"
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate"
import { resolveReadPath } from "./path-utils"

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

export type ReadToolInput = Static<typeof readSchema>

export interface ReadToolDetails {
  truncation?: TruncationResult
}

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>
  access: (absolutePath: string) => Promise<void>
}

const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
}

export interface ReadToolOptions {
  operations?: ReadOperations
}

export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
  const ops = options?.operations ?? defaultReadOperations

  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    execute: async (_toolCallId, { path, offset, limit }, signal?: AbortSignal) => {
      const absolutePath = resolveReadPath(path, cwd)
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"))
          return
        }

        let aborted = false
        const onAbort = () => {
          aborted = true
          reject(new Error("Operation aborted"))
        }
        signal?.addEventListener("abort", onAbort, { once: true })

        ;(async () => {
          try {
            await ops.access(absolutePath)

            if (aborted) {
              return
            }

            const buffer = await ops.readFile(absolutePath)
            const textContent = buffer.toString("utf-8")
            const allLines = textContent.split("\n")
            const startLine = offset ? Math.max(0, offset - 1) : 0
            if (startLine >= allLines.length) {
              signal?.removeEventListener("abort", onAbort)
              reject(new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`))
              return
            }

            const selectedContent = limit !== undefined ? allLines.slice(startLine, startLine + limit).join("\n") : allLines.slice(startLine).join("\n")
            const truncation = truncateHead(selectedContent)
            let outputText = truncation.content
            const notices: string[] = []

            if (truncation.firstLineExceedsLimit) {
              const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"))
              outputText = `[Line ${startLine + 1} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit.]`
            } else if (truncation.truncated) {
              const endLineDisplay = startLine + truncation.outputLines
              notices.push(`[Showing lines ${startLine + 1}-${endLineDisplay} of ${allLines.length}. Use offset=${endLineDisplay + 1} to continue.]`)
              outputText = `${truncation.content}\n\n${notices.join(" ")}`
            } else if (limit !== undefined && startLine + limit < allLines.length) {
              const remaining = allLines.length - (startLine + limit)
              outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${startLine + limit + 1} to continue.]`
            }

            signal?.removeEventListener("abort", onAbort)
            resolve({
              content: [{ type: "text", text: outputText }],
              details: truncation.truncated ? { truncation } : undefined,
            })
          } catch (error) {
            signal?.removeEventListener("abort", onAbort)
            if (!aborted) {
              reject(error)
            }
          }
        })()
      })
    },
  }
}

export const readTool = createReadTool(process.cwd())

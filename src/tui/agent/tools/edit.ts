import type { AgentTool } from "@mariozechner/pi-agent-core"
import { Type } from "@sinclair/typebox"
import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises"
import { dirname } from "node:path"
import { resolveToCwd } from "./path-utils"

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
  label: Type.Optional(Type.String({ description: "Brief description of the edit (for visibility)" })),
})

export interface EditToolOptions {
  operations?: {
    readFile: (absolutePath: string) => Promise<string>
    writeFile: (absolutePath: string, content: string) => Promise<void>
    mkdir: (dir: string) => Promise<void>
  }
}

const defaultEditOperations = {
  readFile: (absolutePath: string) => fsReadFile(absolutePath, "utf-8"),
  writeFile: (absolutePath: string, content: string) => fsWriteFile(absolutePath, content),
  mkdir: (dir: string) => fsMkdir(dir, { recursive: true }).then(() => {}),
}

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
  const operations = options?.operations ?? defaultEditOperations

  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by replacing exact text. The oldText must match exactly (including whitespace).",
    parameters: editSchema,
    execute: async (_toolCallId, { path: targetPath, oldText, newText }, signal?: AbortSignal) => {
      const absolutePath = resolveToCwd(targetPath, cwd)
      const dir = dirname(absolutePath)

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"))
          return
        }

        const onAbort = () => reject(new Error("Operation aborted"))
        signal?.addEventListener("abort", onAbort, { once: true })

        ;(async () => {
          try {
            await operations.mkdir(dir)
            if (signal?.aborted) {
              return
            }

            const current = await operations.readFile(absolutePath)
            if (signal?.aborted) {
              return
            }

            if (oldText.length === 0) {
              reject(new Error("oldText must not be empty"))
              return
            }

            const occurrences = current.split(oldText).length - 1
            if (occurrences === 0) {
              reject(new Error(`Could not find the exact text in ${targetPath}.`))
              return
            }
            if (occurrences > 1) {
              reject(
                new Error(
                  `Found ${occurrences} occurrences of the old text in ${targetPath}. Use more specific oldText to ensure a unique replacement.`,
                ),
              )
              return
            }

            const index = current.indexOf(oldText)
            const next = current.slice(0, index) + newText + current.slice(index + oldText.length)

            if (next === current) {
              reject(new Error(`No changes made to ${targetPath}.`))
              return
            }

            if (signal?.aborted) {
              return
            }

            await operations.writeFile(absolutePath, next)
            signal?.removeEventListener("abort", onAbort)
            resolve({
              content: [{ type: "text", text: `Replaced text in ${targetPath} (${oldText.length} -> ${newText.length} chars).` }],
              details: {
                replaced: true,
                replacedOccurrences: 1,
              },
            })
          } catch (error) {
            signal?.removeEventListener("abort", onAbort)
            if (!signal?.aborted) {
              reject(error)
            }
          }
        })()
      })
    },
  }
}

export const editTool = createEditTool(process.cwd())

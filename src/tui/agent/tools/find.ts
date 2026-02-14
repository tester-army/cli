import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { globSync } from "glob"
import path from "node:path"
import { ensureTool } from "./ensure-tool"
import { resolveToCwd } from "./path-utils"
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate"

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
})

export type FindToolInput = Static<typeof findSchema>
const DEFAULT_LIMIT = 1000

export interface FindToolDetails {
  truncation?: TruncationResult
  resultLimitReached?: number
}

export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[]
}

const defaultFindOperations: FindOperations = {
  exists: existsSync,
  glob: (_pattern, _searchCwd, _options) => [],
}

export interface FindToolOptions {
  operations?: FindOperations
}

export function createFindTool(cwd: string, options?: FindToolOptions): AgentTool<typeof findSchema> {
  const customOps = options?.operations

  const globFallback = (pattern: string, searchPath: string, limit: number): string[] => {
    const output = globSync(pattern, {
      cwd: searchPath,
      dot: true,
      absolute: true,
      withFileTypes: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    })

    return output.slice(0, limit)
  }

  const normalizeResults = (searchPath: string, results: string[]) => {
    return results.map((item) => (item.startsWith(searchPath) ? item.slice(searchPath.length + 1) : path.relative(searchPath, item)))
  }

  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore when available. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findSchema,
    execute: async (_toolCallId, { pattern, path: searchDir, limit }, signal?: AbortSignal) => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"))
          return
        }

        const onAbort = () => reject(new Error("Operation aborted"))
        signal?.addEventListener("abort", onAbort, { once: true })

        ;(async () => {
          try {
            const searchPath = resolveToCwd(searchDir || ".", cwd)
            const effectiveLimit = limit ?? DEFAULT_LIMIT
            const ops = customOps ?? defaultFindOperations

            if (customOps?.glob) {
              if (!(await ops.exists(searchPath))) {
                signal?.removeEventListener("abort", onAbort)
                reject(new Error(`Path not found: ${searchPath}`))
                return
              }

              const results = await ops.glob(pattern, searchPath, {
                ignore: ["**/node_modules/**", "**/.git/**"],
                limit: effectiveLimit,
              })

              signal?.removeEventListener("abort", onAbort)
              if (results.length === 0) {
                resolve({ content: [{ type: "text", text: "No files found matching pattern" }], details: undefined })
                return
              }

              const relativized = normalizeResults(searchPath, results)
              const resultLimitReached = relativized.length >= effectiveLimit
              const rawOutput = relativized.join("\n")
              const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER })
              const notices: string[] = []
              const details: FindToolDetails = {}

              if (resultLimitReached) {
                notices.push(`${effectiveLimit} results limit reached`)
                details.resultLimitReached = effectiveLimit
              }

              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
                details.truncation = truncation
              }

              let resultOutput = truncation.content
              if (notices.length > 0) {
                resultOutput += `\n\n[${notices.join(". ")}]`
              }

              resolve({ content: [{ type: "text", text: resultOutput }], details: Object.keys(details).length > 0 ? details : undefined })
              return
            }

            const fdPath = await ensureTool("fd", true)
            let matches: string[] = []

            if (fdPath) {
              const args = ["--glob", "--color=never", "--hidden", "--max-results", String(effectiveLimit)]
              const rootGitignore = path.join(searchPath, ".gitignore")
              const gitignoreFiles = new Set<string>()
              if (existsSync(rootGitignore)) {
                gitignoreFiles.add(rootGitignore)
              }

              try {
                const nestedGitignores = globSync("**/.gitignore", {
                  cwd: searchPath,
                  dot: true,
                  absolute: true,
                  ignore: ["**/node_modules/**", "**/.git/**"],
                })
                for (const file of nestedGitignores) {
                  gitignoreFiles.add(file)
                }
              } catch {
                // best effort
              }

              for (const gitignorePath of gitignoreFiles) {
                args.push("--ignore-file", gitignorePath)
              }
              args.push(pattern, searchPath)

              const result = spawnSync(fdPath, args, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 })
              signal?.removeEventListener("abort", onAbort)
              if (result.error) {
                reject(new Error(`Failed to run fd: ${result.error.message}`))
                return
              }
              const output = result.stdout?.trim() ?? ""
              if (result.status !== 0 && !output) {
                reject(new Error(result.stderr?.trim() || `fd exited with code ${result.status}`))
                return
              }
              matches = output
                .split("\n")
                .map((entry) => entry.trim())
                .filter(Boolean)
                .map((line) => {
                  const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\")
                  let relativePath = line.startsWith(searchPath) ? line.slice(searchPath.length + 1) : path.relative(searchPath, line)
                  if (hadTrailingSlash && !relativePath.endsWith("/")) {
                    relativePath += "/"
                  }
                  return relativePath
                })
            } else {
              matches = globFallback(pattern, searchPath, effectiveLimit)
                .map((match) => path.relative(searchPath, match))
                .slice(0, effectiveLimit)
            }

            signal?.removeEventListener("abort", onAbort)
            if (matches.length === 0) {
              resolve({ content: [{ type: "text", text: "No files found matching pattern" }], details: undefined })
              return
            }

            const resultLimitReached = matches.length >= effectiveLimit
            const rawOutput = matches.join("\n")
            const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER })
            const details: FindToolDetails = {}
            const notices: string[] = []

            if (resultLimitReached) {
              notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
              details.resultLimitReached = effectiveLimit
            }
            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
              details.truncation = truncation
            }

            let resultOutput = truncation.content
            if (notices.length > 0) {
              resultOutput += `\n\n[${notices.join(". ")}]`
            }

            resolve({
              content: [{ type: "text", text: resultOutput }],
              details: Object.keys(details).length > 0 ? details : undefined,
            })
          } catch (error) {
            signal?.removeEventListener("abort", onAbort)
            reject(error)
          }
        })()
      })
    },
  }
}

export const findTool = createFindTool(process.cwd())

import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { createInterface } from "node:readline"
import { globSync } from "glob"
import { readFileSync, statSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { ensureTool } from "./ensure-tool"
import { resolveToCwd } from "./path-utils"
import { DEFAULT_MAX_BYTES, formatSize, GREP_MAX_LINE_LENGTH, type TruncationResult, truncateHead, truncateLine } from "./truncate"

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
})

export type GrepToolInput = Static<typeof grepSchema>
const DEFAULT_LIMIT = 100

export interface GrepToolDetails {
  truncation?: TruncationResult
  matchLimitReached?: number
  linesTruncated?: boolean
}

export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean
  readFile: (absolutePath: string) => Promise<string> | string
}

const defaultGrepOperations: GrepOperations = {
  isDirectory: (absolutePath) => statSync(absolutePath).isDirectory(),
  readFile: (absolutePath) => readFileSync(absolutePath, "utf-8"),
}

export interface GrepToolOptions {
  operations?: GrepOperations
}

function escapePattern(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeLine(line: string): { text: string; wasTruncated: boolean } {
  return truncateLine(line.replace(/\r/g, ""))
}

interface CollectMatchesResult {
  outputLines: string[]
  matchCount: number
  linesTruncated: boolean
  matchLimitReached: boolean
}

function collectMatchesFromContent(
  relativePath: string,
  content: string,
  regex: RegExp,
  context: number,
  maxMatches: number,
): CollectMatchesResult {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const outputLines: string[] = []
  let matchCount = 0
  let linesTruncated = false
  let matchLimitReached = false
  const safeRegex = new RegExp(regex.source, regex.flags.replace(/g/g, ""))

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const sourceLine = lines[lineNumber - 1] ?? ""
    if (!safeRegex.test(sourceLine)) {
      continue
    }

    if (matchCount >= maxMatches) {
      matchLimitReached = true
      break
    }

    matchCount += 1
    const start = context > 0 ? Math.max(1, lineNumber - context) : lineNumber
    const end = context > 0 ? Math.min(lines.length, lineNumber + context) : lineNumber

    for (let current = start; current <= end; current += 1) {
      const normalized = normalizeLine(lines[current - 1] ?? "")
      if (normalized.wasTruncated) {
        linesTruncated = true
      }
      outputLines.push(
        current === lineNumber
          ? `${relativePath}:${current}: ${normalized.text}`
          : `${relativePath}-${current}- ${normalized.text}`,
      )
    }
  }

  return { outputLines, matchCount, linesTruncated, matchLimitReached }
}

interface NormalizeBlockResult {
  lines: string[]
  linesTruncated: boolean
}

function normalizeMatchesOutput(
  relativePath: string,
  matchedLine: number,
  allLines: string[],
  context: number,
): NormalizeBlockResult {
  const start = context > 0 ? Math.max(1, matchedLine - context) : matchedLine
  const end = context > 0 ? Math.min(allLines.length, matchedLine + context) : matchedLine

  const output: string[] = []
  let linesTruncated = false
  for (let current = start; current <= end; current += 1) {
    const normalized = normalizeLine(allLines[current - 1] ?? "")
    if (normalized.wasTruncated) {
      linesTruncated = true
    }
    output.push(
      current === matchedLine
        ? `${relativePath}:${current}: ${normalized.text}`
        : `${relativePath}-${current}- ${normalized.text}`,
    )
  }
  return { lines: output, linesTruncated }
}

export function createGrepTool(cwd: string, options?: GrepToolOptions): AgentTool<typeof grepSchema> {
  const customOps = options?.operations

  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    parameters: grepSchema,
    execute: async (_toolCallId, { pattern, path: searchDir, glob, ignoreCase, literal, context, limit }, signal?: AbortSignal) => {
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
            const ops = customOps ?? defaultGrepOperations
            let isDirectory = false

            try {
              isDirectory = await ops.isDirectory(searchPath)
            } catch {
              signal?.removeEventListener("abort", onAbort)
              reject(new Error(`Path not found: ${searchPath}`))
              return
            }

            const contextValue = context && context > 0 ? context : 0
            const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT)
            const flags = ignoreCase ? "i" : ""
            const expression = literal ? escapePattern(pattern) : pattern
            let regex: RegExp
            try {
              regex = new RegExp(expression, flags)
            } catch (error) {
              signal?.removeEventListener("abort", onAbort)
              reject(error as Error)
              return
            }

            const buildOutputFromFallback = async (): Promise<{
              text: string
              details: GrepToolDetails | undefined
            }> => {
              const patterns = glob
                ? globSync(glob, {
                    cwd: searchPath,
                    absolute: true,
                    dot: true,
                    nodir: true,
                    ignore: ["**/node_modules/**", "**/.git/**"],
                  })
                : globSync("**/*", {
                    cwd: searchPath,
                    absolute: true,
                    dot: true,
                    nodir: true,
                    ignore: ["**/node_modules/**", "**/.git/**"],
                  })

              const outputLines: string[] = []
              let matchCount = 0
              let linesTruncated = false
              let matchLimitReached = false
              const effectiveLimitReached = effectiveLimit

              for (const matchPath of patterns) {
                if (matchCount >= effectiveLimit) {
                  matchLimitReached = true
                  break
                }

                let fileContent = ""
                try {
                  fileContent = await ops.readFile(matchPath)
                } catch {
                  continue
                }

                const result = collectMatchesFromContent(
                  path.relative(searchPath, matchPath),
                  fileContent,
                  regex,
                  contextValue,
                  effectiveLimitReached - matchCount,
                )
                outputLines.push(...result.outputLines)
                matchCount += result.matchCount
                if (result.linesTruncated) {
                  linesTruncated = true
                }
              }

              if (outputLines.length === 0) {
                return { text: "No matches found", details: undefined }
              }

              const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER })
              let resultText = truncation.content
              const notices: string[] = []
              const details: GrepToolDetails = {}

              if (matchLimitReached || matchCount >= effectiveLimit) {
                notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
                details.matchLimitReached = effectiveLimit
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
                details.truncation = truncation
              }
              if (linesTruncated) {
                notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read to inspect full lines`)
                details.linesTruncated = true
              }

              if (notices.length > 0) {
                resultText += `\n\n[${notices.join(". ")}]`
              }
              return { text: resultText, details: Object.keys(details).length > 0 ? details : undefined }
            }

            if (!isDirectory) {
              const fileName = path.basename(searchPath)
              let fileContent = ""
              try {
                fileContent = await ops.readFile(searchPath)
              } catch (error) {
                signal?.removeEventListener("abort", onAbort)
                reject(error as Error)
                return
              }

              const result = collectMatchesFromContent(fileName, fileContent, regex, contextValue, effectiveLimit)
              signal?.removeEventListener("abort", onAbort)
              if (result.outputLines.length === 0) {
                resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined })
                return
              }

              const truncation = truncateHead(result.outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER })
              let outputText = truncation.content
              const notices: string[] = []
              const details: GrepToolDetails = {}

              if (result.matchLimitReached || result.matchCount >= effectiveLimit) {
                notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
                details.matchLimitReached = effectiveLimit
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
                details.truncation = truncation
              }
              if (result.linesTruncated) {
                notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read to inspect full lines`)
                details.linesTruncated = true
              }
              if (notices.length > 0) {
                outputText += `\n\n[${notices.join(". ")}]`
              }

              resolve({ content: [{ type: "text", text: outputText }], details: Object.keys(details).length > 0 ? details : undefined })
              return
            }

            const rgPath = await ensureTool("rg", true)
            if (!rgPath) {
              const fallback = await buildOutputFromFallback()
              signal?.removeEventListener("abort", onAbort)
              resolve({ content: [{ type: "text", text: fallback.text }], details: fallback.details })
              return
            }

            const fileCache = new Map<string, string[]>()
            const linesForPath = async (filePath: string): Promise<string[]> => {
              const cached = fileCache.get(filePath)
              if (cached) {
                return cached
              }

              try {
                const contents = await ops.readFile(filePath)
                const lines = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
                fileCache.set(filePath, lines)
                return lines
              } catch {
                const fallback: string[] = []
                fileCache.set(filePath, fallback)
                return fallback
              }
            }

            const formatPath = (filePath: string) => path.relative(searchPath, filePath).replace(/\\/g, "/")

            const outputLines: string[] = []
            const matches: { filePath: string; lineNumber: number }[] = []
            const seen = new Set<string>()
            let matchCount = 0
            let matchLimitReached = false
            let linesTruncated = false
            let totalLinesRead = false
            let killedDueToLimit = false
            let stderr = ""

            const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"]
            if (ignoreCase) args.push("--ignore-case")
            if (literal) args.push("--fixed-strings")
            if (glob) args.push("--glob", glob)
            args.push(pattern, searchPath)

            const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] })
            const rgStdout = child.stdout
            if (!rgStdout) {
              signal?.removeEventListener("abort", onAbort)
              reject(new Error("ripgrep did not provide stdout"))
              return
            }

            const rl = createInterface({ input: rgStdout })

            const cleanup = () => {
              rl.close()
              signal?.removeEventListener("abort", onAbort)
            }

            const stopChild = () => {
              if (!child.killed) {
                killedDueToLimit = true
                child.kill()
              }
            }

            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString()
            })

            rl.on("line", (line) => {
              if (matchCount >= effectiveLimit) {
                return
              }

              let event: unknown
              try {
                event = JSON.parse(line)
              } catch {
                return
              }

              if (
                typeof event !== "object" ||
                event === null ||
                (event as { type?: unknown }).type !== "match"
              ) {
                return
              }

              const rawPath = (event as { data?: { path?: { text?: unknown }; line_number?: unknown } }).data?.path?.text
              const rawLine = (event as { data?: { line_number?: unknown } }).data?.line_number
              if (typeof rawPath !== "string" || typeof rawLine !== "number") {
                return
              }

              const key = `${rawPath}:${rawLine}`
              if (seen.has(key)) {
                return
              }
              seen.add(key)

              matchCount += 1
              matches.push({ filePath: rawPath, lineNumber: rawLine })

              if (matchCount >= effectiveLimit) {
                matchLimitReached = true
                stopChild()
                return
              }
            })

            child.on("error", (error) => {
              cleanup()
              reject(new Error(`Failed to run ripgrep: ${error.message}`))
            })

            child.on("close", async (code) => {
              cleanup()

              if (signal?.aborted) {
                reject(new Error("Operation aborted"))
                return
              }

              if (!killedDueToLimit && code !== 0 && code !== 1) {
                reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`))
                return
              }

              if (matchCount === 0) {
                resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined })
                return
              }

              for (const match of matches) {
                const lines = await linesForPath(match.filePath)
                const relativePath = formatPath(match.filePath)
                const block = normalizeMatchesOutput(relativePath, match.lineNumber, lines, contextValue)
                outputLines.push(...block.lines)
                if (block.linesTruncated) {
                  linesTruncated = true
                }
                if (outputLines.length >= effectiveLimit * 10) {
                  totalLinesRead = true
                  break
                }
              }

              const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER })
              let output = truncation.content
              const notices: string[] = []
              const details: GrepToolDetails = {}

              if (matchLimitReached) {
                notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
                details.matchLimitReached = effectiveLimit
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
                details.truncation = truncation
              }
              if (linesTruncated) {
                notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read to inspect full lines`)
                details.linesTruncated = true
              }
              if (totalLinesRead) {
                notices.push(`Output truncated to ${effectiveLimit * 10} match blocks`)
              }
              if (notices.length > 0) {
                output += `\n\n[${notices.join(". ")}]`
              }

              resolve({
                content: [{ type: "text", text: output }],
                details: Object.keys(details).length > 0 ? details : undefined,
              })
            })
          } catch (error) {
            signal?.removeEventListener("abort", onAbort)
            reject(error as Error)
          }
        })()
      })
    },
  }
}

export const grepTool = createGrepTool(process.cwd())

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024
export const GREP_MAX_LINE_LENGTH = 500

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: "lines" | "bytes" | null
  totalLines: number
  totalBytes: number
  outputLines: number
  outputBytes: number
  lastLinePartial: boolean
  firstLineExceedsLimit: boolean
  maxLines: number
  maxBytes: number
}

export interface TruncationOptions {
  maxLines?: number
  maxBytes?: number
}

function truncateStringToBytesFromEnd(content: string, maxBytes: number): string {
  let low = 0
  let high = content.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = content.slice(content.length - mid)
    if (Buffer.byteLength(candidate, "utf-8") <= maxBytes) {
      high = mid - 1
      continue
    }
    low = mid
  }

  let start = content.length - low
  let trimmed = content.slice(start)
  while (Buffer.byteLength(trimmed, "utf-8") > maxBytes && start < content.length) {
    start += 1
    trimmed = content.slice(start)
  }

  return trimmed
}

function truncateLineSafe(line: string): string {
  if (Buffer.byteLength(line, "utf-8") <= GREP_MAX_LINE_LENGTH) {
    return line
  }

  return `${line.slice(0, 200)}...`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const firstLineBytes = Buffer.byteLength(lines[0], "utf-8")
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    }
  }

  const outputLines: string[] = []
  let outputBytesCount = 0
  let truncatedBy: "lines" | "bytes" = "lines"

  for (let i = 0; i < lines.length && i < maxLines; i += 1) {
    const line = lines[i]
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0)
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes"
      break
    }
    outputLines.push(line)
    outputBytesCount += lineBytes
  }

  if (outputLines.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines"
  }

  const output = outputLines.join("\n")
  return {
    content: output,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLines.length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const outputLines: string[] = []
  let outputBytesCount = 0
  let truncatedBy: "lines" | "bytes" = "lines"
  let lastLinePartial = false

  for (let i = lines.length - 1; i >= 0 && outputLines.length < maxLines; i -= 1) {
    const line = lines[i]
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0)
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes"
      if (outputLines.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes)
        outputLines.unshift(truncatedLine)
        outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8")
        lastLinePartial = true
      }
      break
    }
    outputLines.unshift(line)
    outputBytesCount += lineBytes
  }

  if (outputLines.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines"
  }

  const output = outputLines.join("\n")
  return {
    content: output,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLines.length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

export function truncateLine(line: string): { text: string; wasTruncated: boolean } {
  const truncated = truncateLineSafe(line)
  return {
    text: truncated,
    wasTruncated: truncated !== line,
  }
}


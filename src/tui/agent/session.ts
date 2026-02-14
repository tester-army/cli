import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@mariozechner/pi-agent-core"
import { type Message as AiMessage, type Model } from "@mariozechner/pi-ai"
import type { ChatTurn, ToolInvocationPolicy } from "./types"
import { buildOrchestratorTools } from "./tools"

type AgentLoopResult =
  | {
      ok: true
      text: string
      modelId: string
    }
  | {
      ok: false
      message: string
    }

type RunBashToolHandle = {
  onChunk: (chunk: string) => void
  onStatus?: (status: string) => void
  onToolResult?: (toolName: string, resultText: string, details?: unknown, isError?: boolean) => void
  onAgentLoop?: (handle: { abort: () => void; signal: AbortSignal }) => void
}

function extractStreamingTextFromEvent(value: AgentEvent): string {
  if (value.type !== "message_update") return ""

  const payload = (value as { assistantMessageEvent?: unknown }).assistantMessageEvent
  if (!payload || typeof payload !== "object") return ""
  const record = payload as { type?: string; delta?: string; content?: unknown; text?: string; thinking?: string }

  if (typeof record.delta === "string" && record.delta.length > 0) return record.delta
  if (typeof record.text === "string" && record.text.length > 0) return record.text

  if (record.type === "text_delta" && typeof record.delta === "string") {
    return record.delta
  }

  return ""
}

function extractTextFromMessage(message: AgentMessage): string {
  if (typeof (message as { text?: string }).text === "string") {
    return (message as { text?: string }).text ?? ""
  }

  const content = (message as { content?: unknown }).content
  if (!content || !Array.isArray(content)) return ""

  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") return ""
      const block = entry as { type?: string; text?: string; thinking?: string }
      if (block.type === "text" && typeof block.text === "string") return block.text
      if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking
      return ""
    })
    .join("")
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if ((message as { role?: string }).role === "assistant") {
      return extractTextFromMessage(message)
    }
  }
  return ""
}

function toToolContentText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value) return ""
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "")).join("")
  }

  if (typeof value !== "object") return String(value)

  const record = value as Record<string, unknown>

  if (Array.isArray(record.content)) {
    const text = record.content
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") return []
        const block = entry as { type?: string; text?: unknown }
        if (typeof block.text === "string") {
          return [block.text]
        }
        return []
      })
      .join("")

    if (text) {
      return text
    }
  }

  if (typeof record.message === "string") {
    return record.message
  }

  return JSON.stringify(record)
}

function collectToolResultText(messages: AgentMessage[]): string[] {
  const entries: string[] = []
  for (const message of messages) {
    if ((message as { role?: string }).role !== "toolResult") {
      continue
    }

    const text = toToolContentText((message as { content?: unknown }).content)
    if (text.trim().length > 0) {
      entries.push(text)
    }
  }
  return entries
}

function usageZero() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function historyToMessages(history: ChatTurn[], model: Model<any>): AiMessage[] {
  return history
    .filter((entry) => entry.content.trim().length > 0)
    .map((entry) => {
      const content: { type: "text"; text: string }[] = [
        {
          type: "text",
          text: entry.content,
        },
      ]

      if (entry.role === "assistant") {
        return {
          role: "assistant" as const,
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: usageZero(),
          stopReason: "stop",
          timestamp: Date.now(),
        }
      }

      return {
        role: "user" as const,
        content,
        timestamp: Date.now(),
      }
    })
}

export interface AgentLoopOptions {
  model: Model<any>
  modelId: string
  prompt: string
  history: ChatTurn[]
  onChunk: RunBashToolHandle["onChunk"]
  onStatus?: RunBashToolHandle["onStatus"]
  onToolResult?: RunBashToolHandle["onToolResult"]
  onAgentLoop?: RunBashToolHandle["onAgentLoop"]
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined
  shouldAllowTool?: ToolInvocationPolicy
  systemPrompt?: string
  buildTools?: (
    getAbortSignal: () => AbortSignal | undefined,
    shouldAllowTool?: ToolInvocationPolicy,
    onStatus?: (status: string) => void,
  ) => AgentTool[]
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const contextMessages = historyToMessages(options.history, options.model)
  const loopAbort = new AbortController()
  let abortLoop: () => void = () => {
    loopAbort.abort()
  }

  const shouldAllowTool: ToolInvocationPolicy = (toolName, args) => {
    return options.shouldAllowTool ? options.shouldAllowTool(toolName, args) : true
  }

  const tools = (options.buildTools ?? buildOrchestratorTools)(
    () => loopAbort.signal,
    shouldAllowTool,
    options.onStatus,
  )

  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? "",
      model: options.model,
      thinkingLevel: "off",
      tools,
      messages: contextMessages as AgentMessage[],
    },
    getApiKey: (provider) => {
      const value = options.getApiKey(provider)
      if (value instanceof Promise) return value
      return Promise.resolve(value)
    },
  })

  abortLoop = () => {
    loopAbort.abort()
    agent.abort()
  }

  if (options.onAgentLoop) {
    options.onAgentLoop({ abort: abortLoop, signal: loopAbort.signal })
  }

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_update") {
      const chunk = extractStreamingTextFromEvent(event)
      if (chunk) {
        options.onChunk(chunk)
      }
    }

    if (event.type === "tool_execution_start" && options.onStatus) {
      options.onStatus(`tool:${event.toolCallId} ${event.toolName}`)
    }

    if (event.type === "tool_execution_end" && options.onStatus) {
      const status = event.isError ? "error" : "complete"
      options.onStatus(`tool:${event.toolName} ${status}`)
    }

    if (event.type === "tool_execution_end" && options.onToolResult) {
      const rawResult = (event as { result?: unknown }).result
      const summary = toToolContentText(rawResult)
      const resultPayload = asObject(asObject(rawResult)?.details)
      options.onToolResult(
        (event as { toolName?: string }).toolName ?? "unknown_tool",
        summary || "Tool execution completed.",
        resultPayload,
        Boolean((event as { isError?: boolean }).isError),
      )
    }
  })

  try {
    await agent.prompt(options.prompt)
    await agent.waitForIdle()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error"
    const isAbort = loopAbort.signal.aborted || errorMessage.toLowerCase().includes("aborted")

    if (isAbort) {
      unsubscribe()
      return {
        ok: true,
        text: "Agent loop stopped by user.",
        modelId: options.modelId,
      }
    }

    if (options.onStatus) {
      options.onStatus(`agent loop error: ${errorMessage}`)
    }
    unsubscribe()
    return {
      ok: false,
      message: errorMessage,
    }
  }

  unsubscribe()

  const final = lastAssistantText(agent.state.messages as AgentMessage[])
  const finalText = final.trim()
  const agentError = typeof agent.state.error === "string" ? agent.state.error : undefined
  const toolOutputs = collectToolResultText(agent.state.messages as AgentMessage[])

  if (!finalText && toolOutputs.length > 0) {
    const summaryHeader = "Task completed. Latest tool results:"
    return {
      ok: true,
      text: `${summaryHeader}\n\n${toolOutputs.slice(-8).join("\n\n")}`,
      modelId: options.modelId,
    }
  }

  if (!finalText && agentError) {
    const errorText = agentError.toLowerCase()
    if (errorText.includes("aborted") || errorText.includes("abort") || errorText.includes("request was aborted")) {
      return {
        ok: true,
        text: "Agent loop stopped by user.",
        modelId: options.modelId,
      }
    }

    return {
      ok: false,
      message: agentError,
    }
  }

  if (!finalText) {
    return {
      ok: true,
      text: "Execution request queued.",
      modelId: options.modelId,
    }
  }

  return {
    ok: true,
    text: finalText,
    modelId: options.modelId,
  }
}

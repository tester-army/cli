export type ChatTurn = {
  role: "user" | "assistant"
  content: string
}

export type ModelChoice = {
  id: string
  provider: string
  model: string
  label: string
}

export type ProviderChoice = {
  id: string
  name: string
  requiresOAuth: boolean
  authenticated: boolean
}

export type LoginWithProviderResult = {
  ok: boolean
  message: string
}

export type AgentResult =
  | {
      ok: true
      text: string
      modelId: string
    }
  | {
      ok: false
      message: string
    }

export type ChatInput = {
  modelId: string
  prompt: string
  history: ChatTurn[]
  onChunk: (chunk: string) => void
  onStatus?: (status: string) => void
  onToolResult?: (toolName: string, resultText: string, details?: unknown, isError?: boolean) => void
  onAgentLoop?: (handle: { abort: () => void; signal: AbortSignal }) => void
}

export type RuntimeSettings = {
  baseUrl?: string
  apiKey?: string
  provider?: string
}

export type ToolInvocationPolicy = (toolName: string, args: Record<string, unknown> | undefined) => boolean

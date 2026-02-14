import {
  Agent,
  type AgentEvent,
  type AgentMessage,
} from "@mariozechner/pi-agent-core"
import {
  getModel,
  getModels,
  getProviders,
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  getEnvApiKey,
  type Message as AiMessage,
  type Model,
  type OAuthCredentials,
} from "@mariozechner/pi-ai"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"

type ChatTurn = {
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
}

const DEFAULT_CONFIG = `${process.env.HOME ?? ""}/.config/testerarmy/testerarmy.json`
const DEFAULT_MODEL = "openai:gpt-5-mini"
const SYSTEM_PROMPT =
  "You are TesterArmy assistant. Keep responses practical and concise. Prefer actionable next steps for testing and automation."

function configPath(): string {
  return process.env.TESTER_ARMY_CONFIG ?? DEFAULT_CONFIG
}

function asNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  if (typeof value !== "number") return
  return Number.isFinite(value) ? value : undefined
}

type RuntimeSettings = {
  baseUrl?: string
  apiKey?: string
  provider?: string
}

type StoredConfig = Record<string, unknown>

type LoginCallbacks = {
  onAuth: (info: { url: string; instructions?: string }) => void
  onProgress?: (message: string) => void
}

function toOAuthCredentials(value: unknown): OAuthCredentials | undefined {
  const record = asRecord(value)
  const refresh = asString(record, "refresh")
  const access = asString(record, "access")
  const expires = asNumber(record, "expires")
  if (!refresh || !access || typeof expires !== "number") return
  return {
    ...(record as OAuthCredentials),
    refresh,
    access,
    expires,
  }
}

function normalizeProviderForConfig(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function readStoredConfig(): Promise<StoredConfig | undefined> {
  const path = configPath()
  const file = Bun.file(path)
  return file
    .json()
    .then((value) => asRecord(value))
    .catch(() => undefined)
}

async function saveStoredConfig(next: StoredConfig): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(next, null, 2))
}

async function loadProviderAuthMap(): Promise<Record<string, OAuthCredentials>> {
  const data = await readStoredConfig()
  const providers = asRecord(data?.providers)
  const rawAuth = asRecord(providers?.auth)

  if (!rawAuth) {
    return {}
  }

  const auth: Record<string, OAuthCredentials> = {}
  for (const [providerId, credentialValue] of Object.entries(rawAuth)) {
    const credentials = toOAuthCredentials(credentialValue)
    if (credentials) {
      auth[normalizeProviderForConfig(providerId)] = credentials
    }
  }

  return auth
}

async function persistProviderAuth(providerId: string, credentials: OAuthCredentials): Promise<void> {
  const data = (await readStoredConfig()) ?? {}
  const providers = asRecord(data.providers) ?? {}
  const existingAuth = asRecord(providers.auth) ?? {}

  providers.auth = {
    ...existingAuth,
    [providerId]: {
      type: "oauth",
      ...credentials,
    },
  }

  data.providers = providers
  await saveStoredConfig(data)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function asString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeModelCandidate(value: string): { provider: string; model: string } {
  const trimmed = value.trim()
  const idx = trimmed.indexOf(":")
  if (idx > 0) {
    return {
      provider: trimmed.slice(0, idx).trim().toLowerCase(),
      model: trimmed.slice(idx + 1).trim(),
    }
  }

  return {
    provider: "openai",
    model: trimmed,
  }
}

function modelChoiceFromId(rawId: string): ModelChoice | undefined {
  const parsed = normalizeModelCandidate(rawId)
  if (!parsed.model) return
  const id = `${parsed.provider}:${parsed.model}`
  return {
    id,
    provider: parsed.provider,
    model: parsed.model,
    label: id,
  }
}

function buildModelChoicesFromRaw(rawCandidates: string[]): ModelChoice[] {
  return rawCandidates
    .map((candidate) => modelChoiceFromId(candidate))
    .filter((candidate): candidate is ModelChoice => Boolean(candidate?.provider && candidate?.model))
    .filter((candidate, index, candidates) => candidates.findIndex((entry) => entry.id === candidate.id) === index)
    .sort((a, b) => a.id.localeCompare(b.id))
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map((value) => value.trim()))).sort((a, b) =>
    a.localeCompare(b),
  )
}

function collectConfiguredModelValues(data: Record<string, unknown> | undefined): string[] {
  const providers = asRecord(data?.providers)
  const piMono = asRecord(providers?.piMono)
  const defaults = asRecord(providers?.defaults)
  const primary = asString(providers, "primary")

  const values = new Set<string>()
  const configuredModel = asString(piMono, "model") ?? process.env.PI_MONO_MODEL
  if (configuredModel) {
    const normalized = normalizeModelCandidate(configuredModel)
    values.add(configuredModel.includes(":") ? configuredModel : `${normalized.provider}:${normalized.model}`)
  }

  if (primary && defaults) {
    const providerModel = asString(defaults, primary)
    if (providerModel) {
      values.add(providerModel.includes(":") ? providerModel : `${primary}:${providerModel}`)
    }
  }

  if (defaults) {
    for (const [provider, modelValue] of Object.entries(defaults)) {
      if (typeof modelValue === "string") {
        values.add(modelValue.includes(":") ? modelValue : `${provider}:${modelValue}`)
      }
    }
  }

  return Array.from(values)
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

function syncProviderConfig(settings: RuntimeSettings | undefined) {
  if (!settings?.apiKey) return

  const provider = (settings.provider ?? "openai").trim().toLowerCase()
  if (provider === "openai" || provider === "openai-compatible") {
    process.env.OPENAI_API_KEY = settings.apiKey
  }
  process.env.OPENAI_API_KEY = provider === "openai" || provider === "openai-compatible" ? settings.apiKey : process.env.OPENAI_API_KEY
  process.env.GEMINI_API_KEY = provider === "google" ? settings.apiKey : process.env.GEMINI_API_KEY
  process.env.ANTHROPIC_API_KEY = provider === "anthropic" ? settings.apiKey : process.env.ANTHROPIC_API_KEY
  process.env.GROQ_API_KEY = provider === "groq" ? settings.apiKey : process.env.GROQ_API_KEY
  process.env.CEREBRAS_API_KEY = provider === "cerebras" ? settings.apiKey : process.env.CEREBRAS_API_KEY
  process.env.XAI_API_KEY = provider === "xai" ? settings.apiKey : process.env.XAI_API_KEY
  process.env.OPENROUTER_API_KEY = provider === "openrouter" ? settings.apiKey : process.env.OPENROUTER_API_KEY
  if (provider === "azure-openai") {
    process.env.AZURE_OPENAI_API_KEY = settings.apiKey
  }

  if (settings.baseUrl) {
    process.env.OPENAI_BASE_URL = settings.baseUrl
    process.env.OPENAI_API_BASE_URL = settings.baseUrl
  }
}

function normalizeProviderId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function isProviderAuthenticated(
  providerId: string,
  oauthAuthMap: Record<string, OAuthCredentials>,
): boolean {
  const normalized = normalizeProviderId(providerId)
  if (!normalized) return false
  return Boolean(oauthAuthMap[normalized]) || Boolean(getEnvApiKey(normalized))
}

export async function listAvailableProviders(): Promise<ProviderChoice[]> {
  const providers = getProviders()
  const oauthProviders = getOAuthProviders()
  const oauthMap = new Map<string, string>()
  for (const provider of oauthProviders) {
    oauthMap.set(normalizeProviderId(provider.id), provider.name)
  }

  const authMap = await loadProviderAuthMap()

  const choices: ProviderChoice[] = providers.map((provider) => {
    const normalized = normalizeProviderId(provider)
    return {
      id: normalized,
      name: oauthMap.get(normalized) ?? provider,
      requiresOAuth: oauthMap.has(normalized),
      authenticated: isProviderAuthenticated(normalized, authMap),
    }
  })

  return choices.sort((a, b) => a.id.localeCompare(b.id))
}

export async function loginWithProvider(
  providerId: string,
  callbacks: LoginCallbacks,
): Promise<LoginWithProviderResult> {
  const normalized = normalizeProviderId(providerId)
  if (!normalized) {
    return { ok: false, message: "Missing provider id." }
  }

  const oauthProvider = getOAuthProvider(normalized)
  if (!oauthProvider) {
    return { ok: false, message: `Provider "${providerId}" does not support OAuth login.` }
  }

  try {
    const credentials = await oauthProvider.login({
      onAuth: (info) => {
        callbacks.onAuth(info)
      },
      onProgress: callbacks.onProgress,
      onPrompt: async () => {
        throw new Error("Manual authorization code input is not supported in this terminal UI.")
      },
    })
    await persistProviderAuth(normalized, credentials)
    return {
      ok: true,
      message: `Authenticated with ${oauthProvider.name}. Credentials saved to ${configPath()}.`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Provider login failed.",
    }
  }
}

async function resolveApiKey(providerId: string): Promise<string | undefined> {
  const normalized = normalizeProviderId(providerId)
  const settings = await loadRuntimeConfig()
  const envApiKey = getEnvApiKey(normalized)
  const configuredProvider = normalizeProviderId(settings?.provider)
  const configuredApiKey = settings?.apiKey

  if (configuredProvider === normalized && configuredApiKey) {
    return configuredApiKey
  }

  if (typeof envApiKey === "string" && envApiKey.length > 0) {
    return envApiKey
  }

  const oauthProvider = getOAuthProvider(normalized)
  if (!oauthProvider) {
    return undefined
  }

  const authMap = await loadProviderAuthMap()
  const result = await getOAuthApiKey(normalized, authMap)
  if (!result) {
    return undefined
  }

  if (result.newCredentials) {
    await persistProviderAuth(normalized, result.newCredentials)
  }

  return result.apiKey
}

async function loadRuntimeConfig(): Promise<RuntimeSettings | undefined> {
  const path = configPath()
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) return undefined

  const data = asRecord(await file.json().catch(() => undefined))
  const providers = asRecord(data?.providers)
  const piMono = asRecord(providers?.piMono)

  return {
    baseUrl:
      process.env.PI_MONO_BASE_URL ??
      asString(piMono, "baseUrl") ??
      asString(piMono, "endpoint"),
    apiKey: process.env.PI_MONO_API_KEY ?? asString(piMono, "apiKey"),
    provider: process.env.PI_MONO_PROVIDER ?? asString(providers, "primary") ?? asString(piMono, "provider") ?? "openai",
  }
}

function buildModelIdFromParts(provider: string, model: string): string {
  if (!provider || !model) return ""
  return model.includes(":") ? model : `${provider}:${model}`
}

export async function getPersistedActiveModel(): Promise<string | undefined> {
  const data = await readStoredConfig()
  if (!data) {
    return
  }

  const providers = asRecord(data.providers)
  const piMono = asRecord(providers?.piMono)
  const rawModel = asString(piMono, "model")?.trim()

  if (rawModel) {
    const parsed = normalizeModelCandidate(rawModel)
    if (!parsed.model) {
      return
    }
    return buildModelIdFromParts(parsed.provider, parsed.model)
  }

  const primary = asString(providers, "primary")?.trim().toLowerCase()
  if (!primary) {
    return
  }

  const defaults = asRecord(providers?.defaults)
  const defaultModel = asString(defaults, primary)?.trim()
  if (!defaultModel) {
    return
  }

  const parsed = normalizeModelCandidate(defaultModel)
  if (!parsed.model) {
    return
  }
  return buildModelIdFromParts(parsed.provider, parsed.model)
}

export async function persistActiveModel(modelId: string): Promise<void> {
  const parsed = normalizeModelCandidate(modelId)
  if (!parsed.model) {
    return
  }

  const normalizedProvider = normalizeProviderForConfig(parsed.provider)
  const data = (await readStoredConfig()) ?? {}
  const providers = asRecord(data.providers) ?? {}

  const piMono = asRecord(providers.piMono) ?? {}
  const nextModel = `${normalizedProvider}:${parsed.model}`

  providers.primary = normalizedProvider
  providers.piMono = {
    ...piMono,
    provider: normalizedProvider,
    model: nextModel,
  }

  data.providers = providers
  await saveStoredConfig(data)
}

function collectDefaultModelChoicesFromConfig(): string[] {
  const values = new Set<string>([DEFAULT_MODEL])
  const envModel = process.env.PI_MONO_MODEL
  if (envModel) {
    values.add(envModel.includes(":") ? envModel : `openai:${envModel}`)
  }
  return Array.from(values)
}

export async function listAvailableModels(): Promise<ModelChoice[]> {
  const path = configPath()
  const file = Bun.file(path)
  const exists = await file.exists()
  const data = exists ? asRecord(await file.json().catch(() => undefined)) : undefined

  const candidates = new Set<string>()
  collectDefaultModelChoicesFromConfig().forEach((value) => candidates.add(value))
  collectConfiguredModelValues(data).forEach((value) => {
    const parsed = normalizeModelCandidate(value)
    if (parsed.model.length > 0) {
      candidates.add(`${parsed.provider}:${parsed.model}`)
    }
  })

  for (const provider of getProviders()) {
    const candidateModels = getModels(provider)
    for (const model of candidateModels as unknown[]) {
      if (typeof model === "string") {
        candidates.add(`${provider}:${model}`)
        continue
      }

      if (model && typeof model === "object") {
        const modelRecord = model as Record<string, unknown>
        const modelId = asString(modelRecord, "id")
        const modelProvider = asString(modelRecord, "provider")
        if (modelId) {
          candidates.add(`${modelProvider ?? provider}:${modelId}`)
        }
      }
    }
  }

  return buildModelChoicesFromRaw(uniqueSorted(Array.from(candidates)))
}

export async function defaultModelChoice(): Promise<ModelChoice> {
  const configured = await listAvailableModels()
  return configured[0] ?? modelChoiceFromId(DEFAULT_MODEL)!
}

export async function resolveModel(modelId: string): Promise<Model<any> | undefined> {
  const normalized = normalizeModelCandidate(modelId)
  if (!normalized.model) return
  return getModel(normalized.provider as never, normalized.model as never) as Model<any> | undefined
}

export async function chatWithAgentCore(input: ChatInput): Promise<AgentResult> {
  const settings = await loadRuntimeConfig()
  const desiredModel = input.modelId.trim().length > 0 ? input.modelId.trim() : (await defaultModelChoice()).id
  const model = await resolveModel(desiredModel)

  if (!model) {
    return {
      ok: false,
      message: `Model "${desiredModel}" is not available. Try /models to see available options.`,
    }
  }

  if (settings) {
    syncProviderConfig(settings)
  }

  const contextMessages = historyToMessages(input.history, model)
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: "off",
      tools: [],
      messages: contextMessages as AgentMessage[],
    },
    getApiKey: (provider) => resolveApiKey(provider),
  })

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_update") {
      const chunk = extractStreamingTextFromEvent(event)
      if (chunk) {
        input.onChunk(chunk)
      }
    }

    if (event.type === "tool_execution_start" && input.onStatus) {
      input.onStatus(`tool:${event.toolCallId} ${event.toolName}`)
    }

    if (event.type === "tool_execution_end" && input.onStatus) {
      const status = event.isError ? "error" : "complete"
      input.onStatus(`tool:${event.toolName} ${status}`)
    }
  })

  try {
    await agent.prompt(input.prompt)
    await agent.waitForIdle()
  } catch (error) {
    unsubscribe()
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Agent invocation failed.",
    }
  }

  unsubscribe()

  const final = lastAssistantText(agent.state.messages as AgentMessage[])
  if (!final.trim()) {
    return {
      ok: false,
      message:
        "The agent did not produce any assistant content. Check that your model has API access and can generate output.",
    }
  }

  return {
    ok: true,
    text: final,
    modelId: `${model.provider}:${model.id}`,
  }
}

export async function chatWithPiMono(input: ChatInput): Promise<AgentResult> {
  return chatWithAgentCore(input)
}

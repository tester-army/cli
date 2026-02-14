import { runAgentLoop } from "./session"
import {
  getModel,
  getModels,
  getProviders,
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  getEnvApiKey,
  type Model,
  type OAuthCredentials,
} from "@mariozechner/pi-ai"
import {
  type AgentResult,
  type ChatInput,
  type ChatTurn,
  type LoginWithProviderResult,
  type ModelChoice,
  type ProviderChoice,
  type RuntimeSettings,
} from "./types"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"

export * from "./types"

const DEFAULT_CONFIG = `${process.env.HOME ?? ""}/.config/testerarmy/testerarmy.json`
const DEFAULT_MODEL = "openai:gpt-5-mini"
const AGENT_BROWSER_SKILL = `name: agent-browser
description: Browser automation with agent-browser for AI agents.
triggers:
  - open
  - click
  - fill
  - screenshot
  - test web app
  - web automation
  - scrape
allowed-tools: Bash(agent-browser:*)

# Browser Automation with agent-browser

Core workflow:
1. \`npx agent-browser open <url>\`
2. \`npx agent-browser snapshot -i\` to gather refs (\`@e1\`, \`@e2\`)
3. interact with refs (\`click\`, \`fill\`, \`select\`, \`check\`, \`press\`)
4. re-snapshot after navigation or DOM changes

## Must-know commands

- \`npx agent-browser open\`, \`npx agent-browser close\`, \`npx agent-browser snapshot -i\`, \`npx agent-browser snapshot -i -C\`, \`npx agent-browser snapshot -s \"#selector\"\`
- \`npx agent-browser click @e1\`, \`npx agent-browser fill @e2 \"text\"\`, \`npx agent-browser type\`, \`npx agent-browser select\`, \`npx agent-browser check\`, \`npx agent-browser press\`
- \`npx agent-browser wait\`, \`npx agent-browser wait --load networkidle\`, \`npx agent-browser wait --url \"**/x\"\`
- \`npx agent-browser get text @e1\`, \`npx agent-browser get url\`, \`npx agent-browser get title\`
- \`npx agent-browser screenshot\`, \`npx agent-browser screenshot --full\`, \`npx agent-browser pdf output.pdf\`
- \`npx agent-browser state save/load\`, \`npx agent-browser --session <name>\`, \`npx agent-browser session list\`

## Important rules

- Refs are invalidated on page change; always re-snapshot after navigation or dynamic updates.
- Prefer semantic fallback (\`find text\`, \`find label\`, \`find role\`) when refs are missing.
- For complex JS evaluation, use \`eval --stdin\`/\`-b\`.
- Visual debugging: \`--headed\`, \`highlight\`, \`record start\`.

## Platform notes

- macOS-first support for local desktop/browser flows.
- Supports local files and optional mobile iOS session workflows.`
const BASE_SYSTEM_PROMPT = `You are a QA testing agent that tests web application features using browser automation.

Your task is to thoroughly test the specified feature and provide a detailed test result.

## Testing Guidelines

- Navigate to the target URL and explore the feature thoroughly
- Test both happy paths and edge cases
- Take screenshots at key steps to document your testing - each screenshot is automatically analyzed for errors
- After critical actions (form submit, login, delete, save), ALWAYS take a screenshot to verify the result
- If screenshot analysis reports "ERROR DETECTED", STOP immediately and report FAILED
- Generate reproducible test steps that can be rerun

## Fail-Fast Policy

You are a QA tester. Your job is to TEST and REPORT, not to fix issues.

**STOP and report FAILED when you see:**
- Command output indicates an application error state or failed critical action
- Screenshot captures an obvious UI error, broken state, or failed confirmation
- Application crashes or broken features

**Keep trying different approaches for:**
- Element not found / selector issues - try different selectors
- Element outside viewport - scroll, use keyboard navigation, or hover first
- Click intercepted - close modals/popups, scroll, or try different interaction

These are normal automation challenges, not application failures.

**A failed test is a VALUABLE result.** It means you found a bug. Report it clearly.

## Issue Reporting

You have access to issue capture by collecting evidence from your tools.

**Workflow:**
1. Perform the test action (navigate, click, fill form, etc.)
2. Verify the outcome (take screenshot, inspect result, confirm command output)
3. If you spot an issue, capture evidence first (screenshot/path + failing output), then continue to next check where possible
4. At the end, provide a clear summary of each issue with evidence

**Rules:**
- Only report real defects — do not flag passing checks
- Always capture evidence before reporting an issue
- Mention exact broken behavior, expected behavior, and reproducibility
- Include concrete evidence such as screenshot paths and command output

## Fact Validation (for technology claims)

When describing a specific version number (e.g. "React 19", "iOS 18", "Android 16"), mention uncertainty and do not assume correctness without evidence.

**Rules:**
1. Never call a version number wrong without evidence.
2. If you are uncertain, prefer a conservative wording and avoid false-positive reports.
3. If evidence is unclear, skip that claim.

## Known False Positives — Do NOT Report

- Extra spaces in text: command output or snapshots can show spacing artifacts that are not visual bugs. Only report spacing issues after visual confirmation.`

const AUTH_INSTRUCTIONS = `## Authentication & Login Forms

When you encounter a login or sign-in form that requires authentication:
1. If the user explicitly specified which credential/role to use, use that one directly.
2. Never invent credentials. Use only credentials provided by the user or explicitly supplied in context.
3. If multiple saved options are available and no role was specified, ask for the preferred one.
4. Keep test flow moving: complete login, verify outcome, then continue testing.`

const SYSTEM_PROMPT = `- **Today is:** ${new Date().toDateString()}

${BASE_SYSTEM_PROMPT}

${AUTH_INSTRUCTIONS}

Use these tool capabilities when available: run_bash, read, write, edit, ls, find, grep.
For website or UI checks, use this exact skill and agent-browser commands only:

${AGENT_BROWSER_SKILL}

For any web UI testing, do not use curl, wget, or plain HTTP clients.
Keep responses practical and concise. Prefer actionable findings and next steps.`

function configPath(): string {
  return process.env.TESTER_ARMY_CONFIG ?? DEFAULT_CONFIG
}

function asNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  if (typeof value !== "number") return
  return Number.isFinite(value) ? value : undefined
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
  return Array.from(new Set(values.filter(Boolean).map((value) => value.trim()))).sort((a, b) => a.localeCompare(b))
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

function syncProviderConfig(settings: RuntimeSettings | undefined) {
  if (!settings?.apiKey) return

  const provider = (settings.provider ?? "openai").trim().toLowerCase()
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

  return runAgentLoop({
    model,
    modelId: `${model.provider}:${model.id}`,
    prompt: input.prompt,
    history: input.history,
    onChunk: input.onChunk,
    onStatus: input.onStatus,
    onToolResult: input.onToolResult,
    onAgentLoop: input.onAgentLoop,
    getApiKey: resolveApiKey,
    systemPrompt: SYSTEM_PROMPT,
  })
}

export async function chatWithQaAgent(input: ChatInput): Promise<AgentResult> {
  return chatWithAgentCore(input)
}

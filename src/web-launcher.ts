import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

type WebLauncherOptions = {
  openBrowser?: boolean
  port?: number
}

const DEFAULT_WEB_PORT = 3000

function workspaceRoot() {
  return join(fileURLToPath(new URL("..", import.meta.url)))
}

function ensurePort(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_WEB_PORT
  const rounded = Math.round(value)
  return rounded > 0 && rounded < 65535 ? rounded : DEFAULT_WEB_PORT
}

function buildBrowserCommand(url: string) {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] }
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] }
  }
  return { command: "xdg-open", args: [url] }
}

async function waitUntilReady(port: number, deadlineMs = 15_000) {
  const endpoint = `http://127.0.0.1:${port}`
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(endpoint, { method: "HEAD", cache: "no-store" })
      if (response.status >= 100 && response.status < 600) {
        return
      }
    } catch {}

    await delay(200)
  }

  throw new Error(`Timed out waiting for web server at ${endpoint}`)
}

export async function runWebMode(options: WebLauncherOptions = {}) {
  const port = ensurePort(options.port)
  const cwd = join(workspaceRoot(), "web")
  const args = ["run", "next", "dev", "--port", `${port}`]
  const child = spawn("bun", args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: `${port}`,
    },
  })

  const cleanup = () => {
    if (child.exitCode === null) {
      child.kill("SIGINT")
    }
  }

  const closeListeners = ["SIGINT", "SIGTERM", "SIGQUIT"] as const
  for (const signal of closeListeners) {
    process.on(signal, () => {
      cleanup()
      process.exit(0)
    })
  }

  if (!child.pid) {
    throw new Error("Failed to launch next.js process.")
  }

  try {
    await waitUntilReady(port)
  } catch (error) {
    cleanup()
    throw error
  }

  if (options.openBrowser !== false) {
    const { command, args } = buildBrowserCommand(`http://127.0.0.1:${port}`)
    spawn(command, args, {
      detached: true,
      stdio: "ignore",
    }).unref()
  }

  return new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve()
    })
    child.once("error", (error) => {
      console.error(`web server failed: ${error}`)
      resolve()
    })
  })
}

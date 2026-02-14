import { runHeadlessMode, type RunCliArgs } from "./headless-run"
import { runWebMode } from "./web-launcher"

type ParsedRunArgs = RunCliArgs & { openBrowser?: boolean }

type RawArgs = {
  command: string | undefined
  runArgs: string[]
  webArgs: string[]
}

function parseArgs(argv: string[]): RawArgs {
  const tokens = [...argv]
  const command = tokens.shift()

  if (!command) {
    return { command: undefined, runArgs: [], webArgs: [] }
  }

  const normalized = command.toLowerCase()
  if (normalized.startsWith("-")) {
    return { command: "web", runArgs: [], webArgs: [command, ...tokens] }
  }

  if (normalized === "web" || normalized === "ui") {
    return { command: "web", runArgs: [], webArgs: tokens }
  }

  if (normalized === "run") {
    return { command: "run", runArgs: tokens, webArgs: [] }
  }

  return { command: normalized, runArgs: tokens, webArgs: tokens }
}

function parseRunFlags(args: string[]): ParsedRunArgs {
  const parsed: ParsedRunArgs = {
    openBrowser: true,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (!arg.startsWith("--")) {
      if (!parsed.goal) {
        parsed.goal = `${args.slice(index).join(" ")}`.trim()
      }
      break
    }

    if (arg === "--help" || arg === "-h") {
      parsed.showHelp = true
      continue
    }

    if (arg === "--json") {
      parsed.json = true
      continue
    }

    if (arg === "--no-open-browser") {
      parsed.openBrowser = false
      continue
    }

    if (arg === "--open-browser") {
      parsed.openBrowser = true
      continue
    }

    if (arg === "--scenario-path" || arg === "--scenario") {
      parsed.scenarioPath = args[++index]
      continue
    }

    if (arg === "--target-url") {
      parsed.targetUrl = args[++index]
      continue
    }

    if (arg === "--goal") {
      parsed.goal = args[++index]
      continue
    }

    if (arg === "--parallelism") {
      const value = Number(args[++index])
      if (Number.isFinite(value)) {
        parsed.parallelism = value
      }
      continue
    }

    if (arg === "--failure-policy") {
      parsed.failurePolicy = args[++index] as ParsedRunArgs["failurePolicy"]
      continue
    }

    if (arg === "--screenshot-policy") {
      parsed.screenshotPolicy = args[++index] as ParsedRunArgs["screenshotPolicy"]
      continue
    }

    if (arg === "--step-timeout-ms") {
      const value = Number(args[++index])
      if (Number.isFinite(value)) {
        parsed.stepTimeoutMs = value
      }
      continue
    }

    if (arg === "--scenario-timeout-ms") {
      const value = Number(args[++index])
      if (Number.isFinite(value)) {
        parsed.scenarioTimeoutMs = value
      }
      continue
    }

    if (arg === "--model") {
      parsed.modelId = args[++index]
      continue
    }

    if (arg === "--label") {
      const value = args[++index]
      if (value) {
        parsed.labels = [...(parsed.labels ?? []), value]
      }
      continue
    }
  }

  return parsed
}

function printUsage() {
  console.log(
    `tester-army
` +
      `
` +
      `Usage:
` +
      `  tester-army               Start local web UI
` +
      `  tester-army web           Start local web UI
` +
      `  tester-army run [options]  Run tests in headless mode
` +
      `
` +
      `Headless options:
` +
      `  --scenario-path PATH       Path to scenario markdown file or directory
` +
      `  --target-url URL           Ad-hoc URL to test
` +
      `  --goal TEXT                Ad-hoc test objective
` +
      `  --parallelism N            Parallel workers
` +
      `  --failure-policy [continue-all|fail-fast]
` +
      `  --screenshot-policy [always|on-failure|never]
` +
      `  --step-timeout-ms N
` +
      `  --scenario-timeout-ms N
` +
      `  --model MODEL              AI model id (eg openai:gpt-5-mini)
` +
      `  --label VALUE              Extra run label
` +
      `  --json                     Output machine-readable JSON
` +
      `  --no-open-browser          Do not auto-open web browser
`,
  )
}

async function runCommand(args: string[]) {
  const runArgs = parseRunFlags(args)

  if (runArgs.showHelp) {
    printUsage()
    return
  }

  await runHeadlessMode(runArgs)
}

async function webCommand(args: string[]) {
  const noOpenBrowser = args.includes("--no-open-browser")
  const portArgIndex = args.findIndex((value) => value === "--port")
  const port = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) : undefined

  await runWebMode({
    openBrowser: !noOpenBrowser,
    port: Number.isFinite(port) ? port : undefined,
  })
}

const parsed = parseArgs(process.argv.slice(2))

if (parsed.command === "run") {
  await runCommand(parsed.runArgs)
} else if (parsed.command === "web") {
  if (parsed.webArgs.includes("--help") || parsed.webArgs.includes("-h")) {
    printUsage()
  } else {
    await webCommand(parsed.webArgs)
  }
} else if (parsed.command === "help") {
  printUsage()
} else {
  await webCommand(parsed.webArgs.length > 0 ? parsed.webArgs : [])
}

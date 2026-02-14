import { readFile } from "node:fs/promises"
import { basename } from "node:path"

export type ScenarioStepKind =
  | "open"
  | "snapshot"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "select"
  | "check"
  | "wait"
  | "get_text"
  | "get_url"
  | "get_title"
  | "screenshot"
  | "assert_url_contains"
  | "assert_text_visible"
  | "assert_title_contains"
  | "assert_selector_visible"
  | "unsupported"

type StepTarget = {
  target?: string
  value?: string
  durationMs?: number
  assertion?: string
  waitMode?: "url" | "networkidle" | "duration" | "selector"
}

export interface ParsedScenarioStep {
  id: string
  kind: ScenarioStepKind
  label: string
  raw: string
  target?: string
  value?: string
  assertions?: string[]
  durationMs?: number
  note?: string
  options?: StepTarget
  waitMode?: "url" | "networkidle" | "duration" | "selector"
}

export interface ParsedScenarioTask {
  scenarioId: string
  sourcePath: string
  fileName: string
  title: string
  index: number
  steps: ParsedScenarioStep[]
  warnings: string[]
}

const HEADING_RE = /^\s*##\s+(.*)\s*$/
const FILE_TITLE_RE = /^\s*#\s*(.+?)\s*$/
const STEP_RE = /^\s*(?:[-*]|\d+\.)\s+(.*)\s*$/

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' || first === "'" || first === "`" || first === "“" || first === "”") && last === first) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function makeStepLabel(kind: ScenarioStepKind, value?: string, target?: string): string {
  if (kind === "open" && value) return `open ${value}`
  if (kind === "click" && target) return `click ${target}`
  if (kind === "fill" && value && target) return `fill ${target}`
  if (kind === "type" && value && target) return `type ${target}`
  if (kind === "select" && value && target) return `select ${value} in ${target}`
  if (kind === "wait") return "wait"
  if (kind.startsWith("assert_")) return value ?? kind
  return value ?? kind
}

function parseAssertionText(raw: string): ParsedScenarioStep | null {
  const openMatch = /^(?:open|visit|navigate to|go to)\s+(.+)$/i.exec(raw)
  if (openMatch) {
    return {
      id: "",
      kind: "open",
      label: "open",
      raw,
      target: stripQuotes(openMatch[1]),
      options: { target: stripQuotes(openMatch[1]) },
    }
  }

  const clickMatch = /^(?:click|tap)\s+(.+)$/i.exec(raw)
  if (clickMatch) {
    return {
      id: "",
      kind: "click",
      label: makeStepLabel("click", undefined, stripQuotes(clickMatch[1])),
      raw,
      target: stripQuotes(clickMatch[1]),
      options: { target: stripQuotes(clickMatch[1]) },
    }
  }

  const fillMatch = /^(?:fill|type)\s+["“'`]?(.+?)["”'`]?[\s]+(?:into|in|to)\s+(.+)$/i.exec(raw)
  if (fillMatch) {
    return {
      id: "",
      kind: fillMatch[0].toLowerCase().startsWith("fill") ? "fill" : "type",
      label: makeStepLabel(
        fillMatch[0].toLowerCase().startsWith("fill") ? "fill" : "type",
        stripQuotes(fillMatch[1]),
        stripQuotes(fillMatch[2]),
      ),
      raw,
      target: stripQuotes(fillMatch[2]),
      value: stripQuotes(fillMatch[1]),
      options: {
        target: stripQuotes(fillMatch[2]),
        value: stripQuotes(fillMatch[1]),
      },
    }
  }

  const pressMatch = /^(?:press)\s+(.+)$/i.exec(raw)
  if (pressMatch) {
    return {
      id: "",
      kind: "press",
      label: makeStepLabel("press", stripQuotes(pressMatch[1])),
      raw,
      target: stripQuotes(pressMatch[1]),
      options: { target: stripQuotes(pressMatch[1]) },
    }
  }

  const selectMatch = /^(?:select)\s+["“'`]?(.+?)["”'`]?[\s]+(?:in|into)\s+(.+)$/i.exec(raw)
  if (selectMatch) {
    return {
      id: "",
      kind: "select",
      label: makeStepLabel("select", stripQuotes(selectMatch[1]), stripQuotes(selectMatch[2])),
      raw,
      target: stripQuotes(selectMatch[2]),
      value: stripQuotes(selectMatch[1]),
      options: {
        target: stripQuotes(selectMatch[2]),
        value: stripQuotes(selectMatch[1]),
      },
    }
  }

  const checkMatch = /^(?:check|verify)\s+(.+)$/i.exec(raw)
  if (checkMatch) {
    return {
      id: "",
      kind: "check",
      label: makeStepLabel("check", undefined, stripQuotes(checkMatch[1])),
      raw,
      target: stripQuotes(checkMatch[1]),
      options: { target: stripQuotes(checkMatch[1]) },
    }
  }

  const waitUrlMatch = /^wait\s+(?:for\s+)?url\s+(.+)$/i.exec(raw)
  if (waitUrlMatch) {
    const target = stripQuotes(waitUrlMatch[1])
    return {
      id: "",
      kind: "wait",
      label: `wait for url ${target}`,
      raw,
      target,
      options: { target, waitMode: "url" },
      durationMs: undefined,
    }
  }

  const waitLoadMatch = /^wait\s+(?:for\s+)?(?:networkidle|network idle|network-idle)/i.exec(raw)
  if (waitLoadMatch) {
    return {
      id: "",
      kind: "wait",
      label: "wait for network idle",
      raw,
      options: { waitMode: "networkidle" },
    }
  }

  const waitDurationMatch = /^wait\s+(?:for\s+)?(\d+)\s*(ms|s|sec|secs|seconds?|milliseconds?)$/i.exec(raw)
  if (waitDurationMatch) {
    const value = Number.parseInt(waitDurationMatch[1], 10)
    const unit = waitDurationMatch[2]?.toLowerCase() ?? "ms"
    const durationMs = unit.startsWith("s") ? value * 1000 : value
    return {
      id: "",
      kind: "wait",
      label: `wait ${durationMs}ms`,
      raw,
      durationMs,
      options: {
        durationMs,
        waitMode: "duration",
      },
    }
  }

  const snapshotMatch = /^snapshot$/i.exec(raw)
  if (snapshotMatch) {
    return {
      id: "",
      kind: "snapshot",
      label: "snapshot",
      raw,
      options: {},
    }
  }

  const screenshotMatch = /^(?:take|capture)?\s*screenshot(?:\s+full)?$/i.exec(raw)
  if (screenshotMatch) {
    return {
      id: "",
      kind: "screenshot",
      label: "screenshot",
      raw,
      options: {},
    }
  }

  const assertionUrlMatch = /^(?:assert|expect)\s+(?:the\s+)?url\s+(?:to\s+)?contains?\s+(.+)$/i.exec(raw)
  if (assertionUrlMatch) {
    const value = stripQuotes(assertionUrlMatch[1])
    return {
      id: "",
      kind: "assert_url_contains",
      label: `assert url contains ${value}`,
      raw,
      value,
      assertions: ["url"],
      options: {
        assertion: "url",
        value,
      },
    }
  }

  const assertionTitleMatch = /^(?:assert|expect)\s+(?:the\s+)?title\s+(?:to\s+)?(?:contain|contains|include|includes)\s+(.+)$/i.exec(
    raw,
  )
  if (assertionTitleMatch) {
    const value = stripQuotes(assertionTitleMatch[1])
    return {
      id: "",
      kind: "assert_title_contains",
      label: `assert title contains ${value}`,
      raw,
      value,
      assertions: ["title"],
      options: {
        assertion: "title",
        value,
      },
    }
  }

  const assertionTextMatch = /^(?:assert|expect)\s+text\s+(.+?)\s+is\s+visible$/i.exec(raw)
  if (assertionTextMatch) {
    const value = stripQuotes(assertionTextMatch[1])
    return {
      id: "",
      kind: "assert_text_visible",
      label: `assert text "${value}" visible`,
      raw,
      value,
      assertions: ["text"],
      target: value,
      options: {
        assertion: "text",
        target: value,
      },
    }
  }

  const assertionSelectorMatch = /^(?:assert|expect)\s+(?:the\s+)?(.+?)\s+is\s+visible$/i.exec(raw)
  if (assertionSelectorMatch) {
    const target = stripQuotes(assertionSelectorMatch[1])
    return {
      id: "",
      kind: "assert_selector_visible",
      label: `assert ${target} visible`,
      raw,
      target,
      options: {
        assertion: "selector",
        target,
      },
    }
  }

  const getTextMatch = /^(?:get|read)\s+(?:the\s+)?text(?:\s+of)?\s+(.+)$/i.exec(raw)
  if (getTextMatch) {
    const target = stripQuotes(getTextMatch[1])
    return {
      id: "",
      kind: "get_text",
      label: `get text ${target}`,
      raw,
      target,
      options: { target },
    }
  }

  const getUrlMatch = /^(?:get|read)\s+(?:the\s+)?url$/i.exec(raw)
  if (getUrlMatch) {
    return {
      id: "",
      kind: "get_url",
      label: "get url",
      raw,
      options: {},
    }
  }

  const getTitleMatch = /^(?:get|read)\s+(?:the\s+)?title$/i.exec(raw)
  if (getTitleMatch) {
    return {
      id: "",
      kind: "get_title",
      label: "get title",
      raw,
      options: {},
    }
  }

  return null
}

function normalizeStep(rawLine: string): ParsedScenarioStep {
  const normalized = rawLine.trim().replace(/\s+/g, " ")
  const matched = parseAssertionText(normalized)
  if (matched) {
    return {
      ...matched,
      id: `step-${Math.random().toString(16).slice(2, 10)}`,
      value: matched.value,
      label: matched.label || normalized,
      raw: normalized,
    }
  }

  return {
    id: `step-${Math.random().toString(16).slice(2, 10)}`,
    kind: "unsupported",
    label: "unsupported",
    raw: normalized,
    note: "Unsupported or unrecognized step syntax.",
  }
}

export async function parseScenarioFiles(paths: string[]): Promise<ParsedScenarioTask[]> {
  const tasks: ParsedScenarioTask[] = []

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    const markdown = await readFile(path, "utf8")
    const fileTitle = extractFileTitle(markdown) || basename(path)
    const sections = parseScenarioFile(markdown, fileTitle, path)

    if (sections.length === 0) {
      tasks.push({
        scenarioId: `scenario-${index + 1}`,
        sourcePath: path,
        fileName: basename(path),
        title: fileTitle,
        index,
        steps: [],
        warnings: ["No scenario sections found; default section created with no steps."],
      })
      continue
    }

    sections.forEach((section, sectionIndex) => {
      tasks.push({
        scenarioId: `${basename(path)}:${sectionIndex + 1}`,
        sourcePath: path,
        fileName: basename(path),
        title: section.title,
        index: sectionIndex,
        steps: section.steps,
        warnings: section.warnings,
      })
    })
  }

  return tasks
}

function extractFileTitle(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  for (const line of lines) {
    const match = FILE_TITLE_RE.exec(line)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return undefined
}

function parseScenarioFile(markdown: string, fileTitle: string, filePath: string): Array<{
  title: string
  steps: ParsedScenarioStep[]
  warnings: string[]
}> {
  const lines = markdown.split(/\r?\n/)
  const sections: Array<{ title: string; steps: ParsedScenarioStep[]; warnings: string[] }> = []
  let currentSection: { title: string; steps: ParsedScenarioStep[]; warnings: string[] } | undefined
  let pendingDefaultSection = true

  const ensureSection = (title?: string) => {
    if (currentSection) {
      sections.push(currentSection)
    }

    const nextTitle = title ?? fileTitle
    currentSection = { title: nextTitle, steps: [], warnings: [] }
  }

  for (const rawLine of lines) {
    const headingMatch = HEADING_RE.exec(rawLine)
    if (headingMatch) {
      ensureSection(headingMatch[1]?.trim() || "Scenario")
      pendingDefaultSection = false
      continue
    }

    const stepMatch = STEP_RE.exec(rawLine)
    if (!stepMatch) {
      continue
    }

    if (!currentSection) {
      ensureSection(fileTitle)
      pendingDefaultSection = false
    }

    const rawStep = stepMatch[1]?.trim() ?? ""
    if (!rawStep) {
      continue
    }

    const step = normalizeStep(rawStep)
    if (step.kind === "unsupported") {
      currentSection?.warnings.push(`Could not parse: "${rawStep}"`)
    }
    currentSection?.steps.push(step)
  }

  if (!currentSection) {
    ensureSection(fileTitle)
    if (pendingDefaultSection) {
      currentSection!.warnings.push(`No markdown steps detected in ${filePath}.`)
    }
  }

  sections.push(currentSection!)

  return sections
}

import { render } from "@opentui/solid"
import { createCliRenderer, type CliRenderer } from "@opentui/core"
import type { JSX } from "solid-js"

export interface TuiRenderer {
  destroy: () => void
  done: Promise<void>
}

export async function createTuiRenderer(App: () => JSX.Element): Promise<TuiRenderer> {
  const stdin = process.stdin
  const stdout = process.stdout
  const noop = () => {}

  if (!stdin.isTTY || !stdout.isTTY) {
    console.warn("No OpenTUI runtime found. Falling back to non-rendered shell.")
    return {
      destroy: noop,
      done: Promise.resolve(),
    }
  }

  try {
    const renderer: CliRenderer = await createCliRenderer({
      stdin,
      stdout,
      useAlternateScreen: false,
      autoFocus: false,
      exitOnCtrlC: false,
      useKittyKeyboard: {},
      targetFps: 60,
      gatherStats: false,
    })
    const done = render(App, renderer)
    return {
      destroy: () => {
        renderer.destroy()
      },
      done,
    }
  } catch (error) {
    throw error
  }
}

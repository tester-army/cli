import { Match, Show, Switch, onMount } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { createTuiRenderer } from "./runtime/opentui"
import { createAppStore } from "./state/store"
import { CommandDock } from "./components/CommandDock"
import { HomeRoute } from "./routes/Home"
import { SessionRoute } from "./routes/Session"
import { ResultsRoute } from "./routes/Results"
import { THEME } from "./theme/opencode"

type CommandProps = {
  commandBuffer: () => string
  commandMode: () => boolean
  isBusy: () => boolean
  activeModel: () => string
  suggestions: () => string[]
  onCommandBuffer: (value: string) => void
  onSubmit: (text?: string) => Promise<unknown>
  onCancelCommand: () => void
  onClear: () => void
  onSuggestionSelect: (command: string) => void
}

function App(props: { onQuit: () => void }) {
  const { state, actions } = createAppStore({ onExit: props.onQuit })
  const terminal = useTerminalDimensions()

  onMount(() => {
    actions.seedWelcome()
  })

  const commandProps: CommandProps = {
    commandBuffer: state.commandBuffer,
    commandMode: state.commandMode,
    isBusy: state.runBusy,
    activeModel: state.activeModel,
    suggestions: state.commandSuggestions,
    onCommandBuffer: actions.updateCommandBuffer,
    onSubmit: actions.submitCommand,
    onCancelCommand: actions.cancelCommand,
    onClear: actions.clearCommandBuffer,
    onSuggestionSelect: actions.selectSuggestion,
  }

  return (
    <box
      width={terminal().width}
      height={terminal().height}
      backgroundColor={THEME.background}
      flexDirection="column"
      gap={1}
      padding={1}
    >
      <Switch>
        <Match when={state.route() === "home"}>
          <HomeRoute {...commandProps} />
        </Match>
        <Match when={state.route() === "session"}>
          <SessionRoute
            messages={state.messages}
            toasts={state.toasts}
            onCopy={(text, copied) => {
              if (!text.trim()) {
                return
              }

              actions.pushToast(copied ? `Copied ${text.length} characters` : "Copy failed")
            }}
            workers={state.workers}
            runState={state.runState}
            commandProps={commandProps}
          />
        </Match>
        <Match when={state.route() === "results"}>
          <ResultsRoute />
        </Match>
      </Switch>
      <Show when={state.route() === "results"}>
        <CommandDock {...commandProps} />
      </Show>
    </box>
  )
}

export async function createTuiApp() {
  let shouldExitOnBoot = false
  let quit: () => void = () => {
    shouldExitOnBoot = true
  }

  const AppRoot = () => <App onQuit={() => quit()} />
  const renderer = await createTuiRenderer(AppRoot)
  quit = () => renderer.destroy()
  if (shouldExitOnBoot) {
    renderer.destroy()
  }
  await renderer.done
}

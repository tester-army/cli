import { CommandDock } from "../components/CommandDock"
import { MessageStream } from "../components/MessageStream"
import type { Message, RunState, WorkerCard } from "../contracts/state"
import { THEME } from "../theme/opencode"

type CommandProps = {
  commandBuffer: () => string
  commandMode: () => boolean
  isBusy: () => boolean
  activeModel: () => string
  suggestions: () => string[]
  onCommandBuffer: (value: string) => void
  onSubmit: () => Promise<unknown>
  onCancelCommand: () => void
  onClear: () => void
  onSuggestionSelect: (command: string) => void
}

export function SessionRoute(props: {
  messages: () => Message[]
  toasts: () => string[]
  workers: () => WorkerCard[]
  runState: () => RunState
  commandProps: CommandProps
}) {
  const { activeModel, ...commandDockProps } = props.commandProps

  return (
    <box flexGrow={1} flexDirection="column" minHeight={0}>
      <MessageStream messages={props.messages} toasts={props.toasts} />
      <box paddingTop={1} flexShrink={0}>
        <CommandDock {...commandDockProps} />
      </box>
      <box
        width="100%"
        paddingTop={1}
        border={["top"]}
        borderColor={THEME.borderSubtle}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={THEME.muted}>{process.cwd()}</text>
        <text fg={THEME.success}>{activeModel()}</text>
      </box>
    </box>
  )
}

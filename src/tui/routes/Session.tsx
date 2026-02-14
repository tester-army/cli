import { CommandDock } from "../components/CommandDock"
import { MessageStream } from "../components/MessageStream"
import type { Message, RunState, WorkerCard } from "../contracts/state"

type CommandProps = {
  commandBuffer: () => string
  commandMode: () => boolean
  isBusy: () => boolean
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
  return (
    <box flexGrow={1} flexDirection="column" minHeight={0}>
      <MessageStream messages={props.messages} toasts={props.toasts} />
      <box paddingTop={1} flexShrink={0}>
        <CommandDock {...props.commandProps} />
      </box>
    </box>
  )
}

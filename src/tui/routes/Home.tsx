import { THEME } from "../theme/opencode"
import { CommandDock } from "../components/CommandDock"
import { Logo } from "../components/Logo"

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

export function HomeRoute(props: CommandProps) {
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={THEME.background}
      alignItems="center"
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexGrow={1} minHeight={0} />
      <box height={2} minHeight={0} />
      <Logo />
      <box height={2} minHeight={0} />
      <text fg={THEME.text}>Local multi-agent test orchestrator</text>
      <box width="100%" maxWidth={92} marginTop={1}>
          <CommandDock
            commandBuffer={props.commandBuffer}
            commandMode={props.commandMode}
            isBusy={props.isBusy}
            suggestions={props.suggestions}
            onCommandBuffer={props.onCommandBuffer}
            onSubmit={props.onSubmit}
            onCancelCommand={props.onCancelCommand}
            onClear={props.onClear}
            onSuggestionSelect={props.onSuggestionSelect}
          />
      </box>
      <box flexGrow={1} minHeight={0} />
      <box
        width="100%"
        paddingTop={1}
        border={["top"]}
        borderColor={THEME.borderSubtle}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={THEME.muted}>{process.cwd()}</text>
        <text fg={THEME.muted}>/quit</text>
      </box>
    </box>
  )
}

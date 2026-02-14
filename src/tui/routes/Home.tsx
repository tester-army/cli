import { THEME } from "../theme/testerarmy"
import { CommandDock } from "../components/CommandDock"
import { Logo } from "../components/Logo"

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
  onDoubleEscape: () => void
  onHistoryBack: () => void
  onHistoryForward: () => void
}

export function HomeRoute(props: CommandProps) {
  const { activeModel, ...commandDockProps } = props

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
        <CommandDock {...commandDockProps} />
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
        <box flexDirection="row" gap={1}>
          <text fg={THEME.muted}>/quit</text>
          <text fg={THEME.muted}>|</text>
          <text fg={THEME.success}>{activeModel()}</text>
        </box>
      </box>
    </box>
  )
}

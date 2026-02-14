import { THEME } from "../theme/opencode"

export function ResultsRoute() {
  return (
    <box flexGrow={1} flexDirection="column" gap={1} backgroundColor={THEME.background}>
      <box gap={1}>
        <text fg={THEME.primary}>Results</text>
        <text fg={THEME.muted}>· summaries and exports</text>
      </box>
      <box flexGrow={1} border={["top"]} borderColor={THEME.borderSubtle} paddingTop={1} flexDirection="column" gap={1}>
        <text fg={THEME.text}>Result and persistence views are placeholders for phase 1.</text>
        <text fg={THEME.muted}>Route is reserved for run summaries and report exports.</text>
      </box>
    </box>
  )
}

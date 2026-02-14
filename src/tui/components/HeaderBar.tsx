import type { RunState } from "../contracts/state"

export function HeaderBar(props: {
  runState: () => RunState
  route: () => "home" | "session" | "results"
  workerCount: () => number
}) {
  const state = props.runState()
  const route = props.route()
  const stateColor = state === "running" ? "#f2ca65" : "#89d98f"
  const routeColor = route === "home" ? "#7aa2ff" : route === "session" ? "#a9d9ff" : "#ffb86c"

  return (
    <box border={["bottom"]} padding={1} gap={1} flexDirection="column">
      <box justifyContent="space-between">
        <box gap={1}>
          <text fg="#7aa2ff">TesterArmy</text>
          <text fg="#8ba1ff">CLI</text>
          <text fg="#5a6574">· phase 1 orchestrator</text>
        </box>
        <box gap={1}>
          <text fg="#8ba1ff">{route.toUpperCase()}</text>
          <text fg="#667087">{`[${state}]`}</text>
          <text fg="#667087">workers:</text>
          <text fg="#e5c07b">{props.workerCount()}</text>
        </box>
      </box>
      <box border={["top"]} paddingTop={1} gap={1}>
        <text fg="#98a8c0">Mode:</text>
        <text fg={stateColor}>{state === "running" ? "executing" : "ready"}</text>
        <text fg={routeColor}>▸</text>
        <text fg="#98a8c0">q:</text>
        <text fg="#ff7b72">quit</text>
      </box>
    </box>
  )
}

import { For, Show } from "solid-js"
import type { WorkerCard } from "../contracts/state"
import { THEME } from "../theme/opencode"

function statusColor(status: WorkerCard["status"]) {
  switch (status) {
    case "running":
      return THEME.warning
    case "done":
      return THEME.success
    case "error":
      return THEME.error
    default:
      return THEME.muted
  }
}

export function WorkerSidebar(props: { workers: () => WorkerCard[] }) {
  return (
    <box
      width={40}
      border={["left"]}
      borderColor={THEME.border}
      padding={1}
      flexDirection="column"
      gap={1}
      backgroundColor={THEME.backgroundPanel}
    >
      <box gap={1} justifyContent="space-between">
        <text fg={THEME.primary}>Agents</text>
        <text fg={THEME.text}>[{String(props.workers().length)}]</text>
      </box>
      <box paddingTop={1} gap={1} flexDirection="column">
        <For each={props.workers()}>
          {(worker) => (
            <box flexDirection="column" gap={1} border={["bottom"]} borderColor={THEME.borderSubtle} paddingBottom={1}>
              <box gap={1} justifyContent="space-between">
                <text fg={THEME.text}>{worker.name}</text>
                <text fg={statusColor(worker.status)}>{worker.status}</text>
              </box>
              <box paddingLeft={1}>
                <text fg={THEME.muted}>{worker.progressText ? worker.progressText : "waiting for assignment"}</text>
              </box>
              <Show when={worker.scenario}>
                <box paddingLeft={1}>
                  <text fg={THEME.primary}>scenario: {worker.scenario}</text>
                </box>
              </Show>
            </box>
          )}
        </For>
        <Show when={props.workers().length === 0}>
          <text fg={THEME.muted}>No workers yet.</text>
        </Show>
      </box>
    </box>
  )
}

import { For, Show } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import type { Selection } from "@opentui/core"
import type { Message } from "../contracts/state"
import { THEME } from "../theme/opencode"

function kindColor(kind: Message["kind"]) {
  switch (kind) {
    case "user":
      return THEME.primary
    case "system":
      return THEME.success
    case "tool":
      return THEME.warning
    case "assistant":
    default:
      return THEME.text
  }
}

function kindLabel(kind: Message["kind"]) {
  switch (kind) {
    case "user":
      return "You"
    case "system":
      return "System"
    case "tool":
      return "Tool"
    case "assistant":
    default:
      return "TesterArmy"
  }
}

function kindBackground(kind: Message["kind"]) {
  switch (kind) {
    case "user":
      return THEME.background
    case "system":
      return "#1d3323"
    case "tool":
      return "#33291d"
    case "assistant":
    default:
      return "#1f2330"
  }
}

type MessageStreamProps = {
  messages: () => Message[]
  toasts: () => string[]
  onCopy?: (text: string, copied: boolean) => void
}

export function MessageStream(props: MessageStreamProps) {
  const renderer = useRenderer()

  const handleCopyShortcut = (event: KeyEvent) => {
    if (!((event.ctrl || event.meta) && event.shift && event.name === "c")) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const selection = renderer.getSelection()
    if (!selection) {
      props.onCopy?.("", false)
      return
    }

    const selectedText = selection.getSelectedText()
    if (!selectedText.trim()) {
      props.onCopy?.("", false)
      return
    }

    const copied = renderer.copyToClipboardOSC52(selectedText)
    if (copied) {
      renderer.clearSelection()
    }
    props.onCopy?.(selectedText, copied)
  }

  const copySelection = (selection: Selection | null) => {
    if (!selection) {
      return
    }

    if (!selection.isActive || selection.isDragging) {
      return
    }

    const selectedText = selection.getSelectedText()
    if (!selectedText.trim()) {
      return
    }

    const copied = renderer.copyToClipboardOSC52(selectedText)
    if (copied) {
      renderer.clearSelection()
    }
    props.onCopy?.(selectedText, copied)
  }

  useKeyboard(handleCopyShortcut)
  useSelectionHandler(copySelection)

  return (
    <scrollbox
      flexGrow={1}
      minHeight={0}
      scrollbarOptions={{ visible: true }}
      horizontalScrollbarOptions={{ visible: false }}
      stickyScroll={true}
      stickyStart="bottom"
      paddingTop={1}
      paddingBottom={1}
      contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
    >
      <For each={props.messages()}>
        {(entry) => (
          <box
            width="100%"
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            border={["left"]}
            borderColor={kindColor(entry.kind)}
            backgroundColor={kindBackground(entry.kind)}
            flexDirection="column"
            gap={1}
          >
            <box flexDirection="row">
              <text fg={kindColor(entry.kind)}>
                <b>{kindLabel(entry.kind)}</b>
              </text>
              <box flexGrow={1} />
              <text fg={THEME.muted}>{entry.at}</text>
            </box>
            <text
              fg={THEME.text}
              wrapMode="char"
              selectable
              selectionBg={THEME.border}
              selectionFg={THEME.text}
            >
              {entry.text}
            </text>
          </box>
        )}
      </For>
      <For each={props.toasts()}>
        {(toast) => (
          <box width="100%" gap={1} paddingLeft={2} paddingRight={2}>
            <text fg={THEME.muted} wrapMode="char">
              {toast}
            </text>
          </box>
        )}
      </For>
      <Show when={props.messages().length === 0}>
        <box paddingLeft={1}>
          <text fg={THEME.muted}>No messages yet.</text>
        </box>
      </Show>
    </scrollbox>
  )
}

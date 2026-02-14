import { createEffect, onCleanup, onMount } from "solid-js"
import type { BorderCharacters, KeyEvent } from "@opentui/core"
import type { TextareaRenderable } from "@opentui/core"
import { THEME } from "../theme/opencode"

const EMPTY_BORDER: BorderCharacters = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export function CommandDock(props: {
  commandBuffer: () => string
  commandMode: () => boolean
  isBusy: () => boolean
  suggestions: () => string[]
  onCommandBuffer: (value: string) => void
  onSubmit: () => Promise<any>
  onCancelCommand: () => void
  onClear: () => void
  onSuggestionSelect: (command: string) => void
}) {
  let input: TextareaRenderable | undefined

  const syncBuffer = () => {
    if (!input || input.isDestroyed) {
      return
    }

    props.onCommandBuffer(input.plainText)
  }

  const setInputText = (value: string) => {
    if (!input || input.isDestroyed) {
      return
    }

    if (input.plainText === value) {
      return
    }

    try {
      input.setText(value)
    } catch (error) {
      if (error instanceof Error && error.message.includes("EditBuffer is destroyed")) {
        return
      }
      throw error
    }
  }

  const submit = async () => {
    if (props.isBusy()) {
      return
    }
    await props.onSubmit()
  }

  const handleKeyDown = (event: KeyEvent) => {
    if (event.name === "tab" && props.commandMode()) {
      event.preventDefault()
      const [first] = props.suggestions()
      if (first) {
        props.onSuggestionSelect(first)
      }
      return
    }

    if ((event.name === "enter" || event.name === "return") && !event.shift) {
      event.preventDefault()
      submit()
    }
  }

  onCleanup(() => {
    input = undefined
  })

  onMount(() => {
    if (input && !props.isBusy()) {
      input.focus()
    }
  })

  createEffect(() => {
    setInputText(props.commandBuffer())
  })

  return (
    <box
      flexShrink={0}
      border={["left"]}
      borderColor={props.commandMode() ? THEME.warning : THEME.border}
      customBorderChars={{
        ...EMPTY_BORDER,
        vertical: "┃",
      }}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={THEME.backgroundPanel}
    >
      <textarea
        ref={(value) => {
          input = value
          setInputText(props.commandBuffer())
          if (!props.isBusy()) {
            value.focus()
          }
        }}
        focused
        minHeight={1}
        maxHeight={6}
        textColor={THEME.text}
        focusedTextColor={THEME.text}
        placeholder="Message TesterArmy"
        onContentChange={syncBuffer}
        onKeyDown={handleKeyDown}
        onSubmit={submit}
      />
    </box>
  )
}

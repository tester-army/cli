import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import type { BorderCharacters, KeyEvent, SubmitEvent } from "@opentui/core"
import type { TextareaRenderable } from "@opentui/core"
import { Portal } from "@opentui/solid"
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
  onSubmit: (text?: string) => Promise<any>
  onCancelCommand: () => void
  onClear: () => void
  onSuggestionSelect: (command: string) => void
  onDoubleEscape: () => void
  onHistoryBack: () => void
  onHistoryForward: () => void
}) {
  let input: TextareaRenderable | undefined
  const [pickerIndex, setPickerIndex] = createSignal(0)
  const [lastEscapePressAt, setLastEscapePressAt] = createSignal(0)
  const maxVisibleSuggestions = 6
  const DOUBLE_ESCAPE_MS = 500

  const suggestions = () => props.suggestions()
  const hasSuggestions = createMemo(() => props.commandMode() && suggestions().length > 0)
  const visibleSuggestions = () => suggestions().slice(0, maxVisibleSuggestions)

  const isPickerCommand = createMemo(() => {
    const trimmed = props.commandBuffer().trim().toLowerCase()
    if (!trimmed.startsWith("/")) {
      return false
    }

    const withoutSlash = trimmed.slice(1).trim()
    if (!withoutSlash) {
      return false
    }

    const command = withoutSlash.split(/\s+/)[0]
    const providers = ["provider", "model", "login"]
    return providers.some((name) => name.startsWith(command) || command.startsWith(name))
  })

  const clampPickerIndex = (index: number, listLength: number) => {
    if (listLength === 0) {
      return 0
    }
    const total = Math.floor(index)
    const normalized = total % listLength
    return normalized < 0 ? normalized + listLength : normalized
  }

  const activeSuggestion = () => {
    const list = visibleSuggestions()
    const idx = clampPickerIndex(pickerIndex(), list.length)
    return list[idx]
  }

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

  const resolvePotentialShortcut = (rawInput: string) => {
    const trimmed = rawInput.trim()
    if (!trimmed.startsWith("/") || trimmed.includes(" ")) {
      return rawInput
    }

    const suggestionList = suggestions()
    const exactMatch = suggestionList.find(
      (suggestion) => suggestion.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exactMatch) {
      return exactMatch
    }

    if (suggestionList.length !== 1) {
      return rawInput
    }

    const single = suggestionList[0]
    return single.toLowerCase().startsWith(trimmed.toLowerCase()) ? single : rawInput
  }

  const submit = async (textOrEvent?: string | SubmitEvent) => {
    if (props.isBusy()) {
      return
    }

    const rawInput =
      typeof textOrEvent === "string" ? textOrEvent : input?.plainText ?? props.commandBuffer()
    const resolvedRaw = resolvePotentialShortcut(rawInput)

    if (!input || input.isDestroyed) {
      props.onClear()
      await props.onSubmit(resolvedRaw)
      return
    }

    try {
      input.setText("")
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("EditBuffer is destroyed"))) {
        throw error
      }
    }
    props.onClear()
    await props.onSubmit(resolvedRaw)
  }

  const applySuggestion = async (suggestion: string) => {
    if (props.isBusy()) {
      return
    }

    props.onSuggestionSelect(suggestion)
    await submit()
  }

  const movePickerSelection = (next: number) => {
    if (!hasSuggestions()) {
      return
    }

    const list = visibleSuggestions()
    const nextIndex = clampPickerIndex(next, list.length)
    setPickerIndex(nextIndex)
    const nextSuggestion = list[nextIndex]
    if (nextSuggestion) {
      props.onSuggestionSelect(nextSuggestion)
    }
  }

  const handleKeyDown = async (event: KeyEvent) => {
    if (event.name !== "escape") {
      setLastEscapePressAt(0)
    }

    if (event.name === "tab" && props.commandMode()) {
      event.preventDefault()
      const next = activeSuggestion()
      if (next) {
        await applySuggestion(next)
      }
      return
    }

    if (event.name === "up") {
      event.preventDefault()
      if (hasSuggestions()) {
        movePickerSelection(pickerIndex() - 1)
        return
      }
      props.onHistoryBack()
      return
    }

    if (event.name === "down") {
      event.preventDefault()
      if (hasSuggestions()) {
        movePickerSelection(pickerIndex() + 1)
        return
      }
      props.onHistoryForward()
      return
    }

    if (event.name === "pageup" && hasSuggestions()) {
      event.preventDefault()
      movePickerSelection(pickerIndex() - maxVisibleSuggestions)
      return
    }

    if (event.name === "pagedown" && hasSuggestions()) {
      event.preventDefault()
      movePickerSelection(pickerIndex() + maxVisibleSuggestions)
      return
    }

    if (event.name === "escape") {
      if (hasSuggestions()) {
        event.preventDefault()
        setLastEscapePressAt(0)
        setPickerIndex(0)
        props.onCancelCommand()
        return
      }

      const now = Date.now()
      const lastPress = lastEscapePressAt()
      setLastEscapePressAt(now)
      if (lastPress && now - lastPress < DOUBLE_ESCAPE_MS) {
        setLastEscapePressAt(0)
        event.preventDefault()
        props.onDoubleEscape()
      } else {
        event.preventDefault()
      }
      return
    }

    if ((event.name === "enter" || event.name === "return") && !event.shift) {
      event.preventDefault()
      if (hasSuggestions() && isPickerCommand()) {
        const next = activeSuggestion()
        if (next) {
          await applySuggestion(next)
          return
        }
      }
      await submit()
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

  createEffect(() => {
    if (!hasSuggestions()) {
      setPickerIndex(0)
      return
    }

    setPickerIndex((current) => clampPickerIndex(current, visibleSuggestions().length))
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
      <Portal>
        <Show when={hasSuggestions()}>
          <box
            position="absolute"
            top={2}
            left={2}
            right={2}
            zIndex={100}
            border
            borderColor={THEME.border}
            backgroundColor={THEME.backgroundPanel}
            paddingLeft={1}
            paddingRight={1}
          >
            <For each={visibleSuggestions()}>
              {(suggestion, index) => {
                const isActive = index() === pickerIndex()
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isActive ? THEME.warning : THEME.backgroundPanel}
                  >
                    <text fg={isActive ? THEME.background : THEME.text}>{suggestion}</text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </Portal>
    </box>
  )
}

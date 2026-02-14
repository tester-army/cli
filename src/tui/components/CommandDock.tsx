import { For } from "solid-js";

export function CommandDock(props: {
  commandBuffer: () => string;
  commandMode: () => boolean;
  isBusy: () => boolean;
  suggestions: () => string[];
  onCommandBuffer: (value: string) => void;
  onSubmit: () => Promise<any>;
  onCancelCommand: () => void;
  onClear: () => void;
  onSuggestionSelect: (command: string) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid", paddingTop: "1", marginTop: "1" }}>
      <div style={{ display: "flex", gap: "1" }}>
        <span>{props.commandMode() ? "cmd" : "input"}</span>
        <input
          value={props.commandBuffer()}
          onInput={(event) => props.onCommandBuffer((event.target as HTMLInputElement).value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter" && !props.isBusy()) {
              await props.onSubmit();
            }
            if (event.key === "Escape") {
              props.onCancelCommand();
            }
          }}
          onKeyDownCapture={(event) => {
            if (event.key === "Tab" && props.commandMode()) {
              event.preventDefault();
              const [first] = props.suggestions();
              if (first) {
                props.onSuggestionSelect(first);
              }
            }
          }}
          onFocus={() => void 0}
          placeholder="Type / to run commands"
          disabled={props.isBusy()}
        />
        <button onClick={() => props.onSubmit()} disabled={props.isBusy()}>
          Enter
        </button>
        <button onClick={() => props.onClear()}>Clear</button>
      </div>
      <div style={{ marginTop: "1" }}>
        <For each={props.suggestions()}>{(item) => <span style={{ marginRight: "1" }}>{item}</span>}</For>
      </div>
    </div>
  );
}

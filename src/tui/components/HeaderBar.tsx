import type { RunState } from "../contracts/state";

export function HeaderBar(props: { runState: () => RunState }) {
  return (
    <div style={{ padding: "1", borderBottom: "1px solid" }}>
      <div>TesterArmy CLI — interactive mode</div>
      <div>Run state: {props.runState()}</div>
    </div>
  );
}


import type { Message } from "../contracts/state";

export function MessageStream(props: { messages: () => Message[]; toasts: () => string[] }) {
  return (
    <section style={{ marginTop: "1", borderTop: "1px solid", paddingTop: "1" }}>
      <div>Messages</div>
      <div style={{ maxHeight: "10", overflowY: "auto" }}>
        {props.messages().map((entry) => (
          <div key={entry.id}>
            <strong>[{entry.kind}]</strong> {entry.at} · {entry.text}
          </div>
        ))}
      </div>
      <div style={{ marginTop: "1" }}>
        {props.toasts().map((toast) => (
          <div key={toast}>• {toast}</div>
        ))}
      </div>
    </section>
  );
}

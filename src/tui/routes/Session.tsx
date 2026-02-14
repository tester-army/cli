import type { Message } from "../contracts/state";

export function SessionRoute(props: { messages: () => Message[] }) {
  const latest = () => props.messages().slice(-8);

  return (
    <section>
      <h3>Session</h3>
      <ul>
        {latest().map((msg) => (
          <li>
            {msg.kind}: {msg.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

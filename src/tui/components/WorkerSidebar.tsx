import type { WorkerCard } from "../contracts/state";

export function WorkerSidebar(props: { workers: () => WorkerCard[] }) {
  return (
    <aside style={{ width: "30%", borderRight: "1px solid", paddingRight: "1" }}>
      <div>Workers</div>
      <div style={{ paddingTop: "1" }}>
        {props.workers().map((worker) => (
          <div key={worker.id} style={{ marginBottom: "1" }}>
            <div>{worker.name}</div>
            <div>
              {worker.status} {worker.progressText ? `• ${worker.progressText}` : ""}
            </div>
            {worker.scenario ? <div>Scenario: {worker.scenario}</div> : null}
          </div>
        ))}
      </div>
    </aside>
  );
}

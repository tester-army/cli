import type { Message } from "../contracts/state";

export interface SimulationContext {
  appendMessage: (message: Message) => void;
  setWorkers: (workers: Array<{ id: string; name: string; status: "idle" | "running" | "done" | "error"; scenario?: string; progressText?: string; elapsedMs?: number }>) => void;
  setRunState: (state: "ready" | "running" | "finished") => void;
}

export async function runMockSimulation(
  args: string,
  ctx: SimulationContext,
): Promise<void> {
  const runWorkers = 3;
  const workers = Array.from({ length: runWorkers }, (_v, index) => ({
    id: `worker-${index + 1}`,
    name: `Worker ${index + 1}`,
    status: "idle" as const,
    scenario: args || "scenarios/login.md",
    progressText: "queued",
  }));

  ctx.setRunState("running");
  ctx.setWorkers(
    workers.map((w) => ({
      ...w,
      status: "running" as const,
      progressText: "starting",
    })),
  );

  const timeline: [string, number][] = [
    ["Preparing session context", 220],
    ["Opening page", 320],
    ["Taking baseline snapshot", 300],
    ["Running assertion checks", 450],
    ["Finalizing worker", 240],
  ];

  for (let step = 0; step < timeline.length; step += 1) {
    const [label, wait] = timeline[step];
    await sleep(wait);

    workers.forEach((worker, index) => {
      ctx.appendMessage({
        id: `msg-${runId()}-${step}-${index}`,
        at: new Date().toISOString(),
        kind: "tool",
        text: `${label} for ${worker.name}`,
      });
    });

    const progress = `${label}`;

    ctx.setWorkers(
      workers.map((worker, idx) => {
        const status: "running" | "done" = step === timeline.length - 1 ? "done" : "running";
        const elapsedMs = (step + 1) * 300 + idx * 25;
        return {
          ...worker,
          status,
          progressText: status === "done" ? "completed" : progress,
          elapsedMs,
        };
      }),
    );
  }

  await sleep(200);

  ctx.setWorkers(
    workers.map((w) => ({
      ...w,
      status: "done" as const,
      progressText: "done",
      elapsedMs: 2000,
    })),
  );

  ctx.appendMessage({
    id: `summary-${runId()}`,
    at: new Date().toISOString(),
    kind: "assistant",
    text: "Run completed in simulation. Worker results: 3 passed, 0 failed, 0 issues.",
  });
  ctx.setRunState("finished");
}

function runId() {
  return `run-${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

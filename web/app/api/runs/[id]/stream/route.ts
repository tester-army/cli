import { NextRequest } from "next/server"
import { checkRun, getRun, subscribe } from "@app/orchestrator/orchestrator"
import type { RunAggregate, RunRecordSummary, RunEvent } from "@app/orchestrator/contracts"

type RunStreamPayload =
  | {
      type: "run-state"
      runId: string
      timestamp: string
      run: RunRecordSummary
      aggregate: RunAggregate | null
    }
  | {
      type: "run-event"
      runId: string
      timestamp: string
      runEvent: RunEvent
      message: string
    }

function eventMessage(event: RunEvent) {
  const base = event.workerId ? ` (${event.workerId})` : ""

  if (event.event === "run.started") return `run.started ${event.scenarioId}${base}`
  if (event.event === "run.finished") return `run.finished`
  if (event.event === "run.cancelled") return `run.cancelled`
  if (event.event === "issue") {
    const issue = event.payload?.issue as { title?: unknown } | undefined
    return `issue${base}: ${typeof issue?.title === "string" ? issue.title : "reported"}`
  }
  if (event.event === "step.start") return `step.start${base}: ${event.payload?.label ?? "step"}`
  if (event.event === "step.complete") {
    const status = typeof event.payload?.status === "string" ? event.payload.status : "done"
    return `step.complete${base}: ${status} ${event.payload?.label ?? "step"}`
  }
  if (event.event === "error") return `error${base}: ${String(event.payload?.reason ?? "unknown")}`
  if (event.event === "summary") return `summary`
  if (event.event === "retry") return `retry`
  if (event.event === "timeout") return `timeout`
  return event.event
}

function createRunState(runId: string) {
  const run = getRun(runId)
  if (!run) return

  const check = checkRun(runId)
  return {
    run,
    aggregate: check.aggregate,
  }
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, payload: RunStreamPayload) {
  const encoder = new TextEncoder()
  const body = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`
  controller.enqueue(encoder.encode(body))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const initial = createRunState(id)
  if (!initial) {
    return new Response("run not found", { status: 404 })
  }

  let stopped = false
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (stopped) return
        stopped = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // no-op
        }
      }

      const publishState = () => {
        if (stopped) return
        const latest = createRunState(id)
        if (!latest) {
          stop()
          return
        }

        sendSse(controller, {
          type: "run-state",
          runId: id,
          timestamp: new Date().toISOString(),
          run: latest.run,
          aggregate: latest.aggregate,
        })

        try {
          const check = checkRun(id)
          if (check.status !== "running") {
            stop()
          }
        } catch {
          stop()
        }
      }

      const onEvent = (event: RunEvent) => {
        if (stopped || event.runId !== id) return

        sendSse(controller, {
          type: "run-event",
          runId: id,
          timestamp: event.timestamp,
          runEvent: event,
          message: eventMessage(event),
        })

        if (event.event === "run.finished" || event.event === "run.cancelled") {
          publishState()
          stop()
        }
      }

      unsubscribe = subscribe(onEvent)
      publishState()
      request.signal.addEventListener("abort", () => {
        stop()
      })

      const tick = createRunState(id)
      if (!tick) {
        stop()
        return
      }

      try {
        if (checkRun(id).status !== "running") {
          stop()
          return
        }
      } catch {
        stop()
        return
      }

      heartbeat = setInterval(() => {
        publishState()
      }, 3000)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

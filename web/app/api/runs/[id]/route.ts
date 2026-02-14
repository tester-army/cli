import { NextResponse, type NextRequest } from "next/server"
import { cancelRun, checkRun, getRun } from "@app/orchestrator/orchestrator"
import type { RunAggregate, RunRecordSummary } from "@app/orchestrator/contracts"

type ApiResponse<T> = {
  ok: boolean
  data?: T
  message?: string
}

type RunDetail = {
  run: RunRecordSummary
  aggregate: RunAggregate | null
}

function fail(message: string, status = 400) {
  return NextResponse.json<ApiResponse<never>>({ ok: false, message }, { status })
}

async function buildRunDetail(runId: string): Promise<RunDetail | undefined> {
  const run = getRun(runId)
  if (!run) return

  const check = checkRun(runId)
  return {
    run,
    aggregate: check.aggregate,
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const detail = await buildRunDetail(id)
  if (!detail) {
    return fail(`Run not found: ${id}`, 404)
  }

  return NextResponse.json<ApiResponse<RunDetail>>({ ok: true, data: detail })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    cancelRun(id)
  } catch (error) {
    return fail(error instanceof Error ? error.message : `Could not cancel run ${id}`, 400)
  }

  const detail = await buildRunDetail(id)
  if (!detail) {
    return fail(`Run not found: ${id}`, 404)
  }

  return NextResponse.json<ApiResponse<RunDetail>>({ ok: true, data: detail })
}

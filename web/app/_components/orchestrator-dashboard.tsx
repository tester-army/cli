"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownRight,
  Bug,
  Camera,
  CircleCheckBig,
  CircleStop,
  RefreshCcw,
  RefreshCw,
  Rocket,
  Target,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader } from "@/components/ai-elements/loader"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type {
  OrchestratorEvidence,
  OrchestratorIssue,
  RunAggregate,
  RunEvent,
  RunRecordSummary,
} from "@app/orchestrator/contracts"

type ApiResponse<T> = {
  ok: boolean
  data?: T
  message?: string
}

type RunStatus = RunRecordSummary["status"]

type StreamEvent = {
  type: "run-event" | "run-state"
  timestamp: string
  runId: string
  run?: RunRecordSummary
  aggregate?: RunAggregate | null
  runEvent?: RunEvent
  message?: string
}

type RunDetail = {
  run: RunRecordSummary
  aggregate: RunAggregate | null
}

type RunStartForm = {
  scenarioPath: string
  targetUrl: string
  goal: string
  parallelism: number
  stepTimeoutMs: number
  scenarioTimeoutMs: number
  failurePolicy: "continue-all" | "fail-fast"
  screenshotPolicy: "always" | "on-failure" | "never"
  modelId: string
  labels: string
}

const EMPTY_FORM: RunStartForm = {
  scenarioPath: "",
  targetUrl: "",
  goal: "",
  parallelism: 4,
  stepTimeoutMs: 15_000,
  scenarioTimeoutMs: 120_000,
  failurePolicy: "continue-all",
  screenshotPolicy: "on-failure",
  modelId: "",
  labels: "",
}

function statusTone(status: RunStatus) {
  if (status === "running") return "secondary"
  if (status === "error") return "destructive"
  if (status === "cancelled") return "outline"
  return "default"
}

function severityTone(severity: OrchestratorIssue["severity"]) {
  if (severity === "blocker" || severity === "high") return "destructive"
  if (severity === "low") return "secondary"
  return "outline"
}

function statusText(status: RunStatus) {
  if (status === "running") return "Running"
  if (status === "finished") return "Finished"
  if (status === "cancelled") return "Cancelled"
  return "Error"
}

function labelForStatus(status: RunStatus) {
  const stamp = statusText(status)
  return <Badge variant={statusTone(status)}>{stamp}</Badge>
}

function toRelativeTime(value: string) {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (!Number.isFinite(date.getTime()) || diff < 0) return "just now"

  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (diff < minute) return `${Math.max(Math.floor(diff / 1000), 1)}s ago`
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  return `${Math.floor(diff / day)}d ago`
}

function artifactUrl(evidence?: OrchestratorEvidence) {
  if (!evidence?.screenshot) return undefined
  return `/api/artifacts?path=${encodeURIComponent(evidence.screenshot)}`
}

async function parseJson<T>(input: string | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  const payload = (await response.json().catch(() => ({}))) as ApiResponse<T>
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || `Request failed: ${response.statusText}`)
  }

  return payload.data as T
}

function getInputValue(event: FormData, key: string) {
  const value = event.get(key)
  if (typeof value !== "string") return ""
  return value.trim()
}

export function OrchestratorDashboard() {
  const [runs, setRuns] = useState<RunRecordSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>()
  const [runDetail, setRunDetail] = useState<RunDetail | undefined>()
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([])
  const [form, setForm] = useState<RunStartForm>(EMPTY_FORM)
  const [isLoadingRuns, setIsLoadingRuns] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState("Select or start a run to begin.")
  const streamRef = useRef<EventSource | null>(null)

  const selectedRun = useMemo(
    () => (selectedRunId ? runs.find((entry) => entry.runId === selectedRunId) : undefined),
    [runs, selectedRunId],
  )

  const issues = runDetail?.run?.issues ?? selectedRun?.issues ?? []
  const aggregate = runDetail?.aggregate ?? null

  const refreshRuns = async () => {
    try {
      const records = await parseJson<RunRecordSummary[]>("/api/runs")
      const sorted = records.sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
      setRuns(sorted)
      setIsLoadingRuns(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch runs"
      setStatusMessage(message)
      setIsLoadingRuns(false)
    }
  }

  const refreshRunDetail = async (runId: string) => {
    const detail = await parseJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`)
    setRunDetail(detail)
  }

  const loadSelected = async (runId: string) => {
    try {
      await refreshRunDetail(runId)
      await refreshRuns()
    } catch {
      setRunDetail(undefined)
    }
  }

  useEffect(() => {
    let active = true
    void refreshRuns()

    const interval = setInterval(() => {
      if (active) {
        void refreshRuns()
      }
    }, 6000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      if (streamRef.current) {
        streamRef.current.close()
        streamRef.current = null
      }
      setRunDetail(undefined)
      return
    }

    void loadSelected(selectedRunId)
    setStatusMessage(`Streaming run ${selectedRunId}`)
    setStreamEvents([])

    const source = new EventSource(`/api/runs/${encodeURIComponent(selectedRunId)}/stream`)
    streamRef.current = source

    const onEvent = (event: MessageEvent<string>) => {
      let payload: StreamEvent | undefined
      try {
        payload = JSON.parse(event.data) as StreamEvent
      } catch {
        return
      }

      if (payload?.type === "run-state") {
        if (payload.run) {
          setRunDetail((prev) =>
            prev
              ? {
                  ...prev,
                  run: payload.run,
                  aggregate: payload.aggregate ?? prev.aggregate,
                }
              : { run: payload.run, aggregate: payload.aggregate ?? null },
          )
          setRuns((current) => {
            const next = current.map((entry) =>
              entry.runId === payload.runId ? { ...entry, ...payload.run } : entry,
            )
            return next.length > 0 ? next : current
          })
        }
      }

      if (payload?.type === "run-event") {
        const message = payload.message ?? payload.runEvent?.event ?? "run-event"
        setStreamEvents((current) =>
          [
            {
              type: "run-event",
              timestamp: payload.timestamp,
              runId: payload.runId ?? selectedRunId ?? "",
              message: `${new Date(payload.timestamp).toLocaleTimeString()} · ${message}`,
            },
            ...current,
          ].slice(0, 50),
        )
      }

      if (
        payload?.runEvent?.event === "run.finished" ||
        payload?.runEvent?.event === "run.cancelled"
      ) {
        if (selectedRunId) {
          void loadSelected(selectedRunId)
          setStatusMessage("Run completed.")
        }
      }
    }

    const onError = () => {
      setStatusMessage("Stream disconnected, retrying...")
      source.close()
    }

    source.addEventListener("run-event", onEvent)
    source.addEventListener("run-state", onEvent)
    source.onerror = onError

    return () => {
      source.removeEventListener("run-event", onEvent)
      source.removeEventListener("run-state", onEvent)
      source.onerror = null
      source.close()
      streamRef.current = null
    }
  }, [selectedRunId])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = {
      scenarioPath: getInputValue(formData, "scenarioPath"),
      targetUrl: getInputValue(formData, "targetUrl"),
      goal: getInputValue(formData, "goal"),
      modelId: getInputValue(formData, "modelId"),
      labels: getInputValue(formData, "labels")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      parallelism: Number(getInputValue(formData, "parallelism")) || form.parallelism,
      stepTimeoutMs: Number(getInputValue(formData, "stepTimeoutMs")) || form.stepTimeoutMs,
      scenarioTimeoutMs: Number(getInputValue(formData, "scenarioTimeoutMs")) || form.scenarioTimeoutMs,
      failurePolicy: (getInputValue(formData, "failurePolicy") || form.failurePolicy) as RunStartForm["failurePolicy"],
      screenshotPolicy: (getInputValue(formData, "screenshotPolicy") || form.screenshotPolicy) as RunStartForm["screenshotPolicy"],
    }

    if (!payload.scenarioPath && !payload.targetUrl && !payload.goal) {
      setStatusMessage("Provide scenarioPath, targetUrl, or goal.")
      return
    }

    setIsSubmitting(true)
    setStatusMessage("Starting run...")

    try {
      const started = await parseJson<{ runId: string }>("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })

      setRuns((current) => [
        ...current,
        {
          runId: started.runId,
          scenarioPath: payload.scenarioPath || payload.targetUrl || payload.goal || "ad-hoc",
          startedAt: new Date().toISOString(),
          parallelism: payload.parallelism,
          status: "running",
          failurePolicy: payload.failurePolicy,
          workers: [],
          issues: [],
          stepsCompleted: 0,
          totalSteps: 0,
        },
      ])
      setForm(EMPTY_FORM)
      setSelectedRunId(started.runId)
      setStatusMessage(`Run started: ${started.runId}`)
      await refreshRuns()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to start run")
    } finally {
      setIsSubmitting(false)
    }
  }

  const onCancel = async () => {
    if (!selectedRunId) return

    try {
      const result = await parseJson<RunDetail>(`/api/runs/${encodeURIComponent(selectedRunId)}`, {
        method: "DELETE",
      })
      setStatusMessage(`Cancelled ${result.run.runId}`)
      await loadSelected(selectedRunId)
      await refreshRuns()
      void result
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to cancel run")
    }
  }

  const canCancel = runDetail?.run?.status === "running"

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Test Orchestration</p>
          <h1 className="mt-1 text-3xl font-semibold">Tester Army Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Run ad-hoc goals or scenario files, observe event streams, and inspect screenshots and issue evidence directly
            in your browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void refreshRuns()} variant="outline" className="gap-2">
            {isLoadingRuns ? <Loader size={14} /> : <RefreshCw size={14} />}
            Refresh runs
          </Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[430px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Launch new run
              <Rocket size={18} />
            </CardTitle>
            <CardDescription>Start quickly in CLI-like mode, but with structured run details.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="scenarioPath">Scenario path or folder</Label>
                <Input
                  id="scenarioPath"
                  name="scenarioPath"
                  value={form.scenarioPath}
                  onChange={(event) => setForm((previous) => ({ ...previous, scenarioPath: event.target.value }))}
                  placeholder="./scenarios or ./login.md"
                  type="text"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetUrl">Target URL</Label>
                <Input
                  id="targetUrl"
                  name="targetUrl"
                  value={form.targetUrl}
                  onChange={(event) => setForm((previous) => ({ ...previous, targetUrl: event.target.value }))}
                  placeholder="https://example.com"
                  type="text"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="goal">Ad-hoc goal</Label>
                <Textarea
                  id="goal"
                  name="goal"
                  value={form.goal}
                  onChange={(event) => setForm((previous) => ({ ...previous, goal: event.target.value }))}
                  placeholder="Buy me a coffee in the cart"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="parallelism">Parallelism</Label>
                  <Input
                    id="parallelism"
                    name="parallelism"
                    value={form.parallelism}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, parallelism: Number(event.target.value) }))
                    }
                    type="number"
                    min={1}
                    max={16}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="modelId">Model</Label>
                  <Input
                    id="modelId"
                    name="modelId"
                    value={form.modelId}
                    onChange={(event) => setForm((previous) => ({ ...previous, modelId: event.target.value }))}
                    placeholder="openai:gpt-5-mini"
                    type="text"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="failurePolicy">Failure policy</Label>
                  <select
                    id="failurePolicy"
                    name="failurePolicy"
                    className={cn(
                      "h-10 w-full rounded-xl border border-border bg-input px-3 text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                    value={form.failurePolicy}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        failurePolicy: event.target.value as RunStartForm["failurePolicy"],
                      }))
                    }
                  >
                    <option value="continue-all">continue-all</option>
                    <option value="fail-fast">fail-fast</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="screenshotPolicy">Screenshot policy</Label>
                  <select
                    id="screenshotPolicy"
                    name="screenshotPolicy"
                    className={cn(
                      "h-10 w-full rounded-xl border border-border bg-input px-3 text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                    value={form.screenshotPolicy}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        screenshotPolicy: event.target.value as RunStartForm["screenshotPolicy"],
                      }))
                    }
                  >
                    <option value="on-failure">on-failure</option>
                    <option value="always">always</option>
                    <option value="never">never</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stepTimeoutMs">Step timeout (ms)</Label>
                  <Input
                    id="stepTimeoutMs"
                    name="stepTimeoutMs"
                    value={form.stepTimeoutMs}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, stepTimeoutMs: Number(event.target.value) }))
                    }
                    type="number"
                    min={250}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scenarioTimeoutMs">Scenario timeout (ms)</Label>
                  <Input
                    id="scenarioTimeoutMs"
                    name="scenarioTimeoutMs"
                    value={form.scenarioTimeoutMs}
                    onChange={(event) =>
                      setForm((previous) => ({ ...previous, scenarioTimeoutMs: Number(event.target.value) }))
                    }
                    type="number"
                    min={250}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="labels">Labels (comma-separated)</Label>
                <Input
                  id="labels"
                  name="labels"
                  value={form.labels}
                  onChange={(event) => setForm((previous) => ({ ...previous, labels: event.target.value }))}
                  placeholder="smoke,release"
                  type="text"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit" className="gap-2" disabled={isSubmitting}>
                  {isSubmitting ? <Loader size={14} /> : <Rocket size={14} />}
                  Start Run
                </Button>
                <Button type="reset" variant="ghost" onClick={() => setForm(EMPTY_FORM)}>
                  Reset form
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Run details</CardTitle>
              <CardDescription>Live stream of run state and evidence</CardDescription>
            </div>
            <Badge variant={canCancel ? "secondary" : "outline"} className="shrink-0">
              {runs.length} Runs
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border/80 bg-card/60 p-4">
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
              {selectedRun ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {labelForStatus(selectedRun.status)}
                  <Badge variant="outline" className="gap-2">
                    <Target size={12} />
                    {selectedRun.scenarioPath}
                  </Badge>
                </div>
              ) : (
                <p className="mt-2 text-sm">No run selected.</p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Card className="bg-secondary/20">
                <CardContent className="space-y-1 py-3">
                  <p className="text-xs text-muted-foreground">Workers</p>
                  <p className="text-xl font-semibold">{selectedRun?.workers?.length ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="bg-secondary/20">
                <CardContent className="space-y-1 py-3">
                  <p className="text-xs text-muted-foreground">Issues</p>
                  <p className="text-xl font-semibold">{issues.length}</p>
                </CardContent>
              </Card>
              <Card className="bg-secondary/20">
                <CardContent className="space-y-1 py-3">
                  <p className="text-xs text-muted-foreground">Pass / Fail</p>
                  <p className="text-xl font-semibold">
                    {aggregate ? `${aggregate.passed} / ${aggregate.failed}` : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {selectedRun && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Workers</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{toRelativeTime(selectedRun.startedAt)}</span>
                    {selectedRun.endedAt && <span>• {toRelativeTime(selectedRun.endedAt)}</span>}
                  </div>
                </div>
                <div className="grid gap-2">
                  {selectedRun.workers?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No worker snapshot yet.</p>
                  ) : (
                    selectedRun.workers.map((worker) => (
                      <div
                        key={worker.id}
                        className={cn(
                          "rounded-lg border border-border/70 bg-card/40 p-3",
                          worker.status === "running" && "ring-1 ring-amber-300/50",
                          worker.status === "done" && "ring-1 ring-emerald-300/40",
                          worker.status === "error" && "ring-1 ring-red-300/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{worker.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {worker.progressText || "idle"} {worker.elapsedMs ? `· ${worker.elapsedMs}ms` : ""}
                            </p>
                          </div>
                          <Badge
                            variant={
                              worker.status === "running"
                                ? "secondary"
                                : worker.status === "done"
                                  ? "outline"
                                  : "destructive"
                            }
                          >
                            {worker.status}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {!!issues.length && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Issues ({issues.length})</p>
                <div className="grid gap-2">
                  {issues.map((issue, index) => {
                    const screenshot = artifactUrl(issue.evidence)
                    return (
                      <div key={`${issue.title}-${index}`} className="rounded-lg border border-border/80 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{issue.title}</p>
                          <Badge variant={severityTone(issue.severity)}>{issue.severity}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{issue.area}</p>
                        <p className="mt-2 text-sm">Expected: {issue.expected}</p>
                        <p className="text-sm">Actual: {issue.actual}</p>
                        {screenshot && (
                          <a
                            href={screenshot}
                            className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Camera size={14} /> View screenshot
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Live stream</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => void (selectedRunId && loadSelected(selectedRunId))}>
                  <RefreshCcw size={12} />
                  Reload
                </Button>
              </div>
              <Table className="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {streamEvents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="px-2 py-4 text-sm text-muted-foreground">
                        No stream yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    streamEvents.map((entry, index) => (
                      <TableRow key={`${entry.timestamp}-${entry.type}-${index}`}>
                        <TableCell>{new Date(entry.timestamp).toLocaleTimeString()}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <ArrowDownRight size={12} />
                            {entry.message}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{entry.runId}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={onCancel} variant="outline" disabled={!canCancel} className="gap-2">
                <CircleStop size={14} />
                Cancel run
              </Button>

              {aggregate?.status === "failed" ? (
                <Badge variant="destructive" className="gap-1">
                  <Bug size={12} />
                  {aggregate.status}
                </Badge>
              ) : aggregate?.status === "passed" ? (
                <Badge variant="default" className="gap-1">
                  <CircleCheckBig size={12} />
                  passed
                </Badge>
              ) : aggregate?.status === "error" ? (
                <Badge variant="destructive" className="gap-1">
                  <CircleStop size={12} />
                  error
                </Badge>
              ) : (
                <Badge variant="outline">{selectedRun?.status ? statusText(selectedRun.status) : "idle"}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/misc";
import { ProgressBar, totalBandVar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";

// ---------------------------------------------------------------------------
// Types (mirror API responses)
// ---------------------------------------------------------------------------

interface BatchProgress {
  batchRunId: string;
  status: string;
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  reviewRequired: number;
  cancelled: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface JobDetail {
  id: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  status: string;
  attempt: number;
  maxRetries: number;
  error: string | null;
  totalScore: number | null;
  flags: string[];
  startedAt: string | null;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

/** Human-friendly error: strip stack traces, shorten Prisma noise. */
function friendlyError(raw: string | null): string {
  if (!raw) return "Unknown error";
  // Prisma timeout
  if (/Can't reach database server/i.test(raw)) return "Database connection timed out";
  // Gemini quota
  if (/429|quota|rate.limit/i.test(raw)) return "API rate limit — wait and retry";
  // Gemini model error
  if (/model.*not.*available/i.test(raw)) return "AI model unavailable — check config";
  // Network
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(raw)) return "Network error — check connectivity";
  // GitHub 404
  if (/Not Found|404/i.test(raw) && /repo|github/i.test(raw)) return "Repository not found on GitHub";
  // Identity leakage (expected)
  if (/identity leakage/i.test(raw)) return "Identity leakage detected — held for review";
  // Insufficient evidence
  if (/insufficient evidence/i.test(raw)) return "Insufficient evidence in repository";
  // Invalid AI output
  if (/model output failed validation/i.test(raw)) return "AI output failed validation — needs review";
  // Truncate
  return raw.length > 120 ? raw.slice(0, 117) + "…" : raw;
}

/** Map job status to CSS classes matching StatusBadge conventions. */
function jobStatusColor(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "var(--ink-3)",
    RUNNING: "var(--info)",
    COMPLETED: "var(--good)",
    FAILED: "var(--bad)",
    REVIEW_REQUIRED: "var(--warn)",
    CANCELLED: "var(--ink-3)",
  };
  return map[status] ?? "var(--ink-3)";
}

function jobStatusLabel(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "Queued",
    RUNNING: "Running",
    COMPLETED: "Completed",
    FAILED: "Failed",
    REVIEW_REQUIRED: "Review required",
    CANCELLED: "Cancelled",
  };
  return map[status] ?? status;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatchPanel({ teamCount }: { teamCount: number }) {
  const toast = useToast();

  // Current batch state
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [jobs, setJobs] = useState<JobDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Is the batch active (should we poll)?
  const isActive = batch && (batch.status === "PENDING" || batch.status === "RUNNING" || batch.status === "PAUSED");
  const isRunning = batch && (batch.status === "PENDING" || batch.status === "RUNNING");
  const isPaused = batch?.status === "PAUSED";

  // -----------------------------------------------------------------------
  // API calls
  // -----------------------------------------------------------------------

  const fetchBatch = useCallback(async (batchId: string, summaryOnly = false) => {
    try {
      const url = `/api/evaluate/batch?id=${batchId}${summaryOnly ? "&summary=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setBatch(data.batch);
      if (data.jobs) setJobs(data.jobs);
    } catch {
      // silent — polling will retry
    }
  }, []);

  const startPolling = useCallback(
    (batchId: string) => {
      // Full fetch first, then poll summaries fast + full every 5th tick.
      fetchBatch(batchId);
      let tick = 0;
      pollRef.current = setInterval(() => {
        tick++;
        fetchBatch(batchId, tick % 5 !== 0);
      }, 3_000);
    },
    [fetchBatch],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Stop polling when batch is done
  useEffect(() => {
    if (batch && !isActive) {
      stopPolling();
      // Do one last full fetch to get final job details.
      fetchBatch(batch.batchRunId);
    }
  }, [batch, isActive, stopPolling, fetchBatch]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Load the most recent batch on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/evaluate/batch");
        if (!res.ok) return;
        const data = await res.json();
        if (data.batches?.length > 0) {
          const latest = data.batches[0];
          await fetchBatch(latest.id);
          // If it's active, start polling.
          if (latest.status === "PENDING" || latest.status === "RUNNING") {
            startPolling(latest.id);
          }
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function evaluateAll() {
    setLoading(true);
    try {
      const res = await fetch("/api/evaluate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Failed to start batch", "error");
        return;
      }
      setBatch(data.batch);
      if (data.skippedTeamIds?.length) {
        toast(`${data.skippedTeamIds.length} team(s) skipped — already evaluating`, "info");
      } else {
        toast(`Batch started — evaluating ${data.batch.total} teams`, "success");
      }
      startPolling(data.batch.batchRunId);
    } catch {
      toast("Network error — could not start batch", "error");
    } finally {
      setLoading(false);
    }
  }

  async function pauseCurrentBatch() {
    if (!batch) return;
    setActionLoading("pause");
    try {
      const res = await fetch("/api/evaluate/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchRunId: batch.batchRunId, action: "pause" }),
      });
      const data = await res.json();
      if (res.ok) {
        setBatch(data.batch);
        toast("Batch paused — running jobs will finish", "info");
      } else {
        toast(data.error ?? "Pause failed", "error");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function resumeCurrentBatch() {
    if (!batch) return;
    setActionLoading("resume");
    try {
      const res = await fetch("/api/evaluate/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchRunId: batch.batchRunId, action: "resume" }),
      });
      const data = await res.json();
      if (res.ok) {
        setBatch(data.batch);
        toast("Batch resumed", "success");
        startPolling(batch.batchRunId);
      } else {
        toast(data.error ?? "Resume failed", "error");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function cancelCurrentBatch() {
    if (!batch) return;
    setActionLoading("cancel");
    try {
      const res = await fetch(`/api/evaluate/batch?id=${batch.batchRunId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setBatch(data.batch);
        toast("Batch cancelled", "info");
        stopPolling();
        fetchBatch(batch.batchRunId);
      } else {
        toast(data.error ?? "Cancel failed", "error");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function retryByStatus(status: "FAILED" | "REVIEW_REQUIRED") {
    if (!batch) return;
    const label = status === "FAILED" ? "failed" : "review-required";
    setActionLoading(`retry-${status}`);
    try {
      const res = await fetch("/api/evaluate/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchRunId: batch.batchRunId, action: "retry", retryStatus: status }),
      });
      const data = await res.json();
      if (res.ok) {
        setBatch(data.batch);
        toast(`Re-queued ${data.requeued} ${label} job(s)`, "success");
        startPolling(batch.batchRunId);
      } else {
        toast(data.error ?? `No ${label} jobs to retry`, "info");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const completed = batch ? batch.completed + batch.failed + batch.reviewRequired + batch.cancelled : 0;
  const progressPct = batch ? pct(completed, batch.total) : 0;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="fade-in-up">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Batch Evaluation</h1>
        <p className="mt-1 text-sm text-ink-2">
          Evaluate all teams at once. Progress updates live while the batch runs.
        </p>
      </header>

      {/* Command panel */}
      <section className="card mb-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Batch controls</h2>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={evaluateAll}
              disabled={loading || !!isActive}
              className="btn-primary"
            >
              {loading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Starting…
                </>
              ) : (
                <>
                  <Icon.spark size={14} />
                  Evaluate all
                </>
              )}
            </button>

            {/* Pause — only when RUNNING */}
            {batch && isRunning && (
              <button
                onClick={pauseCurrentBatch}
                disabled={actionLoading === "pause"}
                className="btn-ghost"
              >
                <PauseIcon size={14} />
                {actionLoading === "pause" ? "Pausing…" : "Pause"}
              </button>
            )}

            {/* Resume — only when PAUSED */}
            {isPaused && (
              <button
                onClick={resumeCurrentBatch}
                disabled={actionLoading === "resume"}
                className="btn-primary"
              >
                <PlayIcon size={14} />
                {actionLoading === "resume" ? "Resuming…" : "Resume"}
              </button>
            )}

            {/* Cancel — when RUNNING or PAUSED */}
            {batch && isActive && (
              <button
                onClick={cancelCurrentBatch}
                disabled={actionLoading === "cancel"}
                className="btn-ghost"
              >
                <Icon.close size={14} />
                {actionLoading === "cancel" ? "Cancelling…" : "Cancel"}
              </button>
            )}

            {/* Retry Failed — when batch is done and has failed jobs */}
            {batch && !isActive && batch.failed > 0 && (
              <button
                onClick={() => retryByStatus("FAILED")}
                disabled={actionLoading === "retry-FAILED"}
                className="btn-ghost"
              >
                <Icon.evaluations size={14} />
                {actionLoading === "retry-FAILED"
                  ? "Retrying…"
                  : `Retry failed (${batch.failed})`}
              </button>
            )}

            {/* Retry Review Required — when batch is done and has review jobs */}
            {batch && !isActive && batch.reviewRequired > 0 && (
              <button
                onClick={() => retryByStatus("REVIEW_REQUIRED")}
                disabled={actionLoading === "retry-REVIEW_REQUIRED"}
                className="btn-ghost"
              >
                <Icon.alert size={14} />
                {actionLoading === "retry-REVIEW_REQUIRED"
                  ? "Retrying…"
                  : `Retry review required (${batch.reviewRequired})`}
              </button>
            )}
          </div>

          {!batch && (
            <p className="mt-3 text-xs text-ink-3">
              {teamCount} team{teamCount !== 1 ? "s" : ""} with repositories ready for evaluation.
            </p>
          )}
        </div>
      </section>

      {/* Progress overview */}
      {batch && (
        <section className="card mb-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
              )}
              {isPaused && (
                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              )}
              <h2 className="text-sm font-semibold text-ink">
                {isPaused ? "Paused" : isRunning ? "Running" : batch.status === "CANCELLED" ? "Cancelled" : "Complete"}
              </h2>
            </div>
            <span className="mono text-xs text-ink-3" title={batch.batchRunId}>
              {batch.batchRunId.slice(0, 12)}…
            </span>
          </div>

          <div className="p-4">
            {/* Progress bar */}
            <div className="mb-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-ink">
                  {progressPct}% complete
                </span>
                <span className="text-xs text-ink-3">
                  {completed} / {batch.total} teams processed
                </span>
              </div>
              <ProgressBar
                value={progressPct}
                color={isPaused ? "var(--warn)" : isRunning ? "var(--info)" : batch.failed > 0 ? "var(--warn)" : "var(--good)"}
                height={8}
              />
            </div>

            {/* Stat pills */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatPill label="Total" value={batch.total} color="var(--ink)" />
              <StatPill label="Completed" value={batch.completed} color="var(--good)" />
              <StatPill label="Running" value={batch.running} color="var(--info)" pulse={batch.running > 0} />
              <StatPill label="Queued" value={batch.queued} color="var(--ink-3)" />
              <StatPill label="Failed" value={batch.failed} color="var(--bad)" />
              <StatPill label="Review" value={batch.reviewRequired} color="var(--warn)" />
            </div>

            {/* Timing info */}
            {batch.startedAt && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-3">
                <span>Started {new Date(batch.startedAt).toLocaleTimeString()}</span>
                {batch.completedAt && (
                  <span>
                    Finished {new Date(batch.completedAt).toLocaleTimeString()}
                    {" · "}
                    {elapsed(batch.startedAt, batch.completedAt)}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Jobs table */}
      {jobs.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Team results</h2>
            <span className="chip ml-auto">{jobs.length} teams</span>
          </div>

          {/* Column headers */}
          <div className="hidden grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_1.5fr] gap-4 border-b border-hair px-4 py-2.5 text-xs font-medium text-ink-3 sm:grid">
            <span>Team</span>
            <span>Status</span>
            <span className="text-right">Score</span>
            <span className="text-center">Retries</span>
            <span>Details</span>
          </div>

          <div className="divide-y divide-[var(--glass-border)]">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_1.5fr] sm:items-center sm:gap-4"
              >
                {/* Team */}
                <div>
                  <div className="font-semibold text-ink">{job.teamName}</div>
                  <div className="mono text-xs text-ink-3">{job.teamCode}</div>
                </div>

                {/* Status */}
                <div>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: jobStatusColor(job.status) }}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${job.status === "RUNNING" ? "animate-pulse" : ""}`}
                      style={{ background: "currentColor" }}
                    />
                    {jobStatusLabel(job.status)}
                  </span>
                </div>

                {/* Score */}
                <div className="sm:text-right">
                  {job.totalScore != null ? (
                    <div className="nums text-sm font-bold text-ink">
                      {fmt(job.totalScore)}
                      <span className="font-normal text-ink-3"> /100</span>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-3">—</span>
                  )}
                  {job.totalScore != null && (
                    <ProgressBar
                      value={job.totalScore}
                      color={totalBandVar(job.totalScore)}
                      className="mt-1 sm:ml-auto sm:w-16"
                      height={4}
                    />
                  )}
                </div>

                {/* Retries */}
                <div className="text-center">
                  <span className="nums text-xs text-ink-2">
                    {job.attempt > 0 ? job.attempt : "—"}
                    <span className="text-ink-3"> / {job.maxRetries + 1}</span>
                  </span>
                </div>

                {/* Details / error / flags */}
                <div className="min-w-0">
                  {job.flags.length > 0 && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {job.flags.map((f) => (
                        <span key={f} className="chip text-[10px]">{f.replace(/_/g, " ").toLowerCase()}</span>
                      ))}
                    </div>
                  )}
                  {job.error && (
                    <div
                      className="max-w-full truncate text-[11px]"
                      style={{ color: job.status === "REVIEW_REQUIRED" ? "var(--warn)" : "var(--bad)" }}
                      title={job.error}
                    >
                      {friendlyError(job.error)}
                    </div>
                  )}
                  {job.status === "COMPLETED" && !job.error && (
                    <span className="text-[11px] text-ink-3">Evaluation complete</span>
                  )}
                  {job.status === "QUEUED" && (
                    <span className="text-[11px] text-ink-3">Waiting in queue</span>
                  )}
                  {job.status === "RUNNING" && (
                    <span className="text-[11px] text-info">Evaluating…</span>
                  )}
                  {job.status === "CANCELLED" && (
                    <span className="text-[11px] text-ink-3">Cancelled by organizer</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  color,
  pulse = false,
}: {
  label: string;
  value: number;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hair bg-surface-2 px-3 py-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ background: color }}
      />
      <div>
        <div className="nums text-sm font-bold text-ink">{value}</div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</div>
      </div>
    </div>
  );
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="6,3 20,12 6,21" />
    </svg>
  );
}

function elapsed(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

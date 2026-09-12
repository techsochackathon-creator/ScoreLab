"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalRunDetail {
  id: string;
  name: string;
  status: string;
  totalTeams: number;
  forcedFinalization: boolean;
  finalizationNote: string | null;
  rubricVersion: string | null;
  promptVersion: string | null;
  modelVersion: string | null;
  finalizedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  snapshot: SnapshotTeam[] | null;
}

interface SnapshotTeam {
  rank: number;
  teamId: string;
  teamName: string;
  university: string;
  track: string;
  totalScore: number;
  confidence: number | null;
  flags: string[];
  model: string | null;
  promptVersion: string | null;
  rubricVersion: string | null;
  evaluatedAt: string | null;
}

interface Readiness {
  ready: boolean;
  totalTeams: number;
  evaluated: number;
  unevaluated: number;
  failed: number;
  reviewRequired: number;
  evaluating: number;
  incompleteEvidence: number;
  activeBatches: number;
  issues: string[];
}

type DialogType = "finalize" | "publish" | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusColor: Record<string, string> = {
  DRAFT: "var(--ink-3)",
  EVALUATING: "var(--info)",
  FINALIZED: "var(--warn)",
  PUBLISHED: "var(--good)",
};

const statusLabel: Record<string, string> = {
  DRAFT: "Draft",
  EVALUATING: "Evaluating",
  FINALIZED: "Finalized",
  PUBLISHED: "Published",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EvalRunPanel() {
  const toast = useToast();
  const [runs, setRuns] = useState<EvalRunDetail[]>([]);
  const [selected, setSelected] = useState<EvalRunDetail | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [forceNote, setForceNote] = useState("");
  const [showSnapshot, setShowSnapshot] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/eval-runs");
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/eval-runs?id=${id}`);
      if (!res.ok) return;
      const data: EvalRunDetail = await res.json();
      setSelected(data);
      setRuns((prev) => prev.map((r) => (r.id === id ? data : r)));
    } catch { /* ignore */ }
  }, []);

  const fetchReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/eval-runs?readiness=1");
      if (!res.ok) return;
      const data: Readiness = await res.json();
      setReadiness(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // When a run is selected, also fetch readiness.
  useEffect(() => {
    if (selected && (selected.status === "DRAFT" || selected.status === "EVALUATING")) {
      fetchReadiness();
    }
  }, [selected, fetchReadiness]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function createRun() {
    setLoading(true);
    try {
      const res = await fetch("/api/eval-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Failed to create run", "error"); return; }
      toast("Evaluation run created", "success");
      await fetchRuns();
      setSelected(data);
    } catch {
      toast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }

  async function doFinalize(force: boolean) {
    if (!selected) return;
    setActionLoading("finalize");
    try {
      const res = await fetch("/api/eval-runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: selected.id,
          action: "finalize",
          force,
          note: force ? forceNote || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Finalization failed", "error"); return; }
      toast("Run finalized — scores locked", "success");
      setSelected(data);
      setDialog(null);
      setForceNote("");
      await fetchRuns();
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function doPublish() {
    if (!selected) return;
    setActionLoading("publish");
    try {
      const res = await fetch("/api/eval-runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: selected.id, action: "publish" }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Publish failed", "error"); return; }
      toast("Leaderboard published", "success");
      setSelected(data);
      setDialog(null);
      await fetchRuns();
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function doUnpublish() {
    if (!selected) return;
    setActionLoading("unpublish");
    try {
      const res = await fetch("/api/eval-runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: selected.id, action: "unpublish" }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Unpublish failed", "error"); return; }
      toast("Leaderboard unpublished", "info");
      setSelected(data);
      await fetchRuns();
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteRun() {
    if (!selected) return;
    setActionLoading("delete");
    try {
      const res = await fetch(`/api/eval-runs?id=${selected.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Delete failed", "error"); return; }
      toast("Draft run deleted", "info");
      setSelected(null);
      await fetchRuns();
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function revertDraft() {
    if (!selected) return;
    setActionLoading("revert");
    try {
      const res = await fetch("/api/eval-runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: selected.id, action: "revert" }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? "Revert failed", "error"); return; }
      toast("Reverted to draft", "info");
      setSelected(data);
      await fetchRuns();
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Evaluation Runs</h1>
        <p className="mt-1 text-sm text-ink-2">
          Create, finalize, and publish evaluation runs. The public leaderboard shows only the published run.
        </p>
      </header>

      {/* Actions */}
      <section className="card mb-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Run management</h2>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={createRun} disabled={loading} className="btn-primary">
              {loading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating…
                </>
              ) : (
                <>
                  <Icon.plus size={14} />
                  New run
                </>
              )}
            </button>

            {selected?.status === "DRAFT" && (
              <button onClick={() => { fetchReadiness(); setDialog("finalize"); }} className="btn-ghost">
                <Icon.check size={14} />
                Finalize
              </button>
            )}

            {selected?.status === "EVALUATING" && (
              <>
                <button onClick={() => { fetchReadiness(); setDialog("finalize"); }} className="btn-ghost">
                  <Icon.check size={14} />
                  Finalize
                </button>
                <button onClick={revertDraft} disabled={actionLoading === "revert"} className="btn-ghost">
                  {actionLoading === "revert" ? "Reverting…" : "Back to draft"}
                </button>
              </>
            )}

            {selected?.status === "FINALIZED" && (
              <button onClick={() => setDialog("publish")} className="btn-primary">
                <Icon.external size={14} />
                Publish
              </button>
            )}

            {selected?.status === "PUBLISHED" && (
              <button onClick={doUnpublish} disabled={actionLoading === "unpublish"} className="btn-ghost">
                {actionLoading === "unpublish" ? "Unpublishing…" : "Unpublish"}
              </button>
            )}

            {selected?.status === "DRAFT" && (
              <button onClick={deleteRun} disabled={actionLoading === "delete"} className="btn-ghost" style={{ color: "var(--bad)" }}>
                {actionLoading === "delete" ? "Deleting…" : "Delete draft"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Run list */}
      <section className="card mb-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Runs</h2>
          <span className="chip ml-auto">{runs.length}</span>
        </div>

        {runs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-3">
            No evaluation runs yet. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-[var(--glass-border)]">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => { setSelected(run); setShowSnapshot(false); fetchRun(run.id); }}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${selected?.id === run.id ? "bg-surface-2" : ""}`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: statusColor[run.status] ?? "var(--ink-3)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{run.name}</span>
                    <span className="chip text-[10px]">{statusLabel[run.status] ?? run.status}</span>
                  </div>
                  <div className="text-xs text-ink-3">
                    {run.totalTeams > 0 ? `${run.totalTeams} teams` : "No snapshot yet"}
                    {" · "}
                    Created {fmtDate(run.createdAt)}
                  </div>
                </div>
                <Icon.chevronRight size={14} className="shrink-0 text-ink-3" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Selected run detail */}
      {selected && (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor[selected.status] }} />
              <h2 className="text-sm font-semibold text-ink">{selected.name}</h2>
              <span className="chip text-[10px]">{statusLabel[selected.status]}</span>
            </div>
            <span className="mono text-xs text-ink-3">{selected.id.slice(0, 12)}…</span>
          </div>

          <div className="p-4">
            {/* Status-specific information */}

            {/* DRAFT / EVALUATING: show readiness */}
            {(selected.status === "DRAFT" || selected.status === "EVALUATING") && readiness && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-ink">Finalization readiness</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <ReadinessPill label="Total teams" value={readiness.totalTeams} />
                  <ReadinessPill label="Evaluated" value={readiness.evaluated} ok />
                  <ReadinessPill label="Unevaluated" value={readiness.unevaluated} warn={readiness.unevaluated > 0} />
                  <ReadinessPill label="Failed" value={readiness.failed} warn={readiness.failed > 0} />
                  <ReadinessPill label="Review required" value={readiness.reviewRequired} warn={readiness.reviewRequired > 0} />
                  <ReadinessPill label="In progress" value={readiness.evaluating} warn={readiness.evaluating > 0} />
                  <ReadinessPill label="Low evidence" value={readiness.incompleteEvidence} warn={readiness.incompleteEvidence > 0} />
                  <ReadinessPill label="Active batches" value={readiness.activeBatches} warn={readiness.activeBatches > 0} />
                </div>
                {readiness.issues.length > 0 && (
                  <div className="mt-3 rounded-lg border border-hair bg-surface-2 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--warn)" }}>
                      <Icon.alert size={12} />
                      Issues to resolve before finalization
                    </div>
                    <ul className="flex flex-col gap-1">
                      {readiness.issues.map((issue) => (
                        <li key={issue} className="text-xs text-ink-3">• {issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {readiness.ready && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--good)" }}>
                    <Icon.check size={12} />
                    All checks pass — ready to finalize
                  </div>
                )}
              </div>
            )}

            {/* FINALIZED / PUBLISHED: show provenance */}
            {(selected.status === "FINALIZED" || selected.status === "PUBLISHED") && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-ink">Run provenance</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <span className="text-ink-3">Teams:</span>{" "}
                    <span className="font-medium text-ink">{selected.totalTeams}</span>
                  </div>
                  <div>
                    <span className="text-ink-3">Model:</span>{" "}
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-ink-2">{selected.modelVersion ?? "—"}</code>
                  </div>
                  <div>
                    <span className="text-ink-3">Prompt:</span>{" "}
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-ink-2">{selected.promptVersion ?? "—"}</code>
                  </div>
                  <div>
                    <span className="text-ink-3">Rubric:</span>{" "}
                    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-ink-2">{selected.rubricVersion ? selected.rubricVersion.slice(0, 16) : "—"}</code>
                  </div>
                  <div>
                    <span className="text-ink-3">Finalized:</span>{" "}
                    <span className="font-medium text-ink">{fmtDate(selected.finalizedAt)}</span>
                  </div>
                  {selected.publishedAt && (
                    <div>
                      <span className="text-ink-3">Published:</span>{" "}
                      <span className="font-medium text-ink">{fmtDate(selected.publishedAt)}</span>
                    </div>
                  )}
                </div>
                {selected.forcedFinalization && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-hair bg-surface-2 p-2 text-xs">
                    <Icon.alert size={12} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
                    <div>
                      <span className="font-medium text-ink">Finalized with exceptions</span>
                      {selected.finalizationNote && (
                        <p className="mt-0.5 text-ink-3">{selected.finalizationNote}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Snapshot toggle */}
            {selected.snapshot && selected.snapshot.length > 0 && (
              <div>
                <button
                  onClick={() => setShowSnapshot(!showSnapshot)}
                  className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-brand transition-colors"
                >
                  <Icon.chevronRight
                    size={14}
                    className="transition-transform"
                    style={{ transform: showSnapshot ? "rotate(90deg)" : "none" }}
                  />
                  Ranking snapshot ({selected.snapshot.length} teams)
                </button>

                {showSnapshot && (
                  <div className="overflow-x-auto">
                    {/* Column headers */}
                    <div className="hidden min-w-[600px] grid-cols-[auto_1.5fr_0.8fr_0.6fr_0.6fr] gap-4 border-b border-hair px-4 py-2 text-xs font-medium text-ink-3 sm:grid">
                      <span className="w-8 text-center">#</span>
                      <span>Team</span>
                      <span>Track</span>
                      <span className="text-right">Score</span>
                      <span className="text-right">Confidence</span>
                    </div>
                    <div className="min-w-[600px] divide-y divide-[var(--glass-border)]">
                      {selected.snapshot.map((t) => (
                        <div key={t.teamId} className="grid grid-cols-[auto_1.5fr_0.8fr_0.6fr_0.6fr] items-center gap-4 px-4 py-2.5">
                          <span className="mono w-8 text-center text-sm font-medium text-ink-3">{t.rank}</span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-ink">{t.teamName}</div>
                            <div className="truncate text-xs text-ink-3">{t.university}</div>
                          </div>
                          <span className="chip text-[10px]">{t.track}</span>
                          <div className="text-right">
                            <span className="nums text-sm font-bold text-ink">{t.totalScore.toFixed(1)}</span>
                            <ProgressBar
                              value={t.totalScore}
                              color="var(--brand)"
                              className="mt-1 ml-auto w-16"
                              height={3}
                            />
                          </div>
                          <div className="nums text-right text-xs text-ink-2">
                            {t.confidence != null ? (t.confidence * 100).toFixed(0) + "%" : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Confirmation dialogs ─── */}

      {/* FINALIZE dialog */}
      {dialog === "finalize" && selected && (
        <ConfirmDialog
          title="Finalize evaluation run"
          onClose={() => { setDialog(null); setForceNote(""); }}
        >
          <p className="text-sm text-ink-2">
            Finalizing locks all scores and rankings. No further evaluations can change these results.
            To make changes, you will need to create a new evaluation run.
          </p>

          {readiness && !readiness.ready && (
            <div className="mt-4 rounded-lg border border-hair bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--warn)" }}>
                <Icon.alert size={14} />
                Unresolved issues
              </div>
              <ul className="mb-3 flex flex-col gap-1">
                {readiness.issues.map((issue) => (
                  <li key={issue} className="text-xs text-ink-3">• {issue}</li>
                ))}
              </ul>
              <label className="block text-xs text-ink-2">
                <span className="font-medium">Reason for proceeding (optional):</span>
                <textarea
                  value={forceNote}
                  onChange={(e) => setForceNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hair bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-3"
                  rows={2}
                  placeholder="e.g., Team X dropped out, remaining teams are fully evaluated"
                />
              </label>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={() => { setDialog(null); setForceNote(""); }} className="btn-ghost">
              Cancel
            </button>
            {readiness?.ready ? (
              <button
                onClick={() => doFinalize(false)}
                disabled={actionLoading === "finalize"}
                className="btn-primary"
              >
                {actionLoading === "finalize" ? "Finalizing…" : "Finalize"}
              </button>
            ) : (
              <button
                onClick={() => doFinalize(true)}
                disabled={actionLoading === "finalize"}
                className="btn-primary"
                style={{ background: "var(--warn)" }}
              >
                {actionLoading === "finalize" ? "Finalizing…" : "Finalize with exceptions"}
              </button>
            )}
          </div>
        </ConfirmDialog>
      )}

      {/* PUBLISH dialog */}
      {dialog === "publish" && selected && (
        <ConfirmDialog
          title="Publish leaderboard"
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-ink-2">
            Publishing makes this evaluation run's rankings visible on the public leaderboard.
            {runs.some((r) => r.status === "PUBLISHED") && (
              <span className="font-medium"> The currently published run will be replaced.</span>
            )}
          </p>

          <div className="mt-3 rounded-lg border border-hair bg-surface-2 p-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-ink-3">Run:</span>{" "}
                <span className="font-medium text-ink">{selected.name}</span>
              </div>
              <div>
                <span className="text-ink-3">Teams:</span>{" "}
                <span className="font-medium text-ink">{selected.totalTeams}</span>
              </div>
              <div>
                <span className="text-ink-3">Model:</span>{" "}
                <span className="font-medium text-ink">{selected.modelVersion ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-3">Finalized:</span>{" "}
                <span className="font-medium text-ink">{fmtDate(selected.finalizedAt)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={() => setDialog(null)} className="btn-ghost">
              Cancel
            </button>
            <button
              onClick={doPublish}
              disabled={actionLoading === "publish"}
              className="btn-primary"
            >
              {actionLoading === "publish" ? "Publishing…" : "Publish to leaderboard"}
            </button>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadinessPill({ label, value, ok, warn }: { label: string; value: number; ok?: boolean; warn?: boolean }) {
  let color = "var(--ink-3)";
  if (ok && value > 0) color = "var(--good)";
  if (warn && value > 0) color = "var(--warn)";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hair bg-surface-2 px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <div>
        <div className="nums text-sm font-bold text-ink">{value}</div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-lg rounded-xl p-6 shadow-xl fade-in-up" style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", backdropFilter: "blur(var(--glass-blur))", WebkitBackdropFilter: "blur(var(--glass-blur))" }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:text-ink">
            <Icon.close size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

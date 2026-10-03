"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge, EmptyState } from "@/components/ui/misc";
import { ProgressBar, totalBandVar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";

export interface TeamOption { id: string; teamCode: string; name: string }
export interface SubmissionRow {
  id: string;
  teamName: string;
  teamCode: string;
  track: string;
  repoUrl: string;
  status: string;
  totalScore: number | null;
  error: string | null;
}

const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const repoShort = (u: string) => u.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");

export function EvaluationsView({ initialSubmissions, teams }: { initialSubmissions: SubmissionRow[]; teams: TeamOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [repoUrl, setRepoUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [rerunId, setRerunId] = useState<string | null>(null);

  async function evaluate(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId || !repoUrl.trim()) return;
    setRunning(true);
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, repoUrl: repoUrl.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setRunning(false);
    if (res.ok && d.submission?.status === "EVALUATED") {
      toast(`Evaluated — total ${fmt(d.submission?.totalScore ?? null)}`, "success");
      setRepoUrl("");
      router.refresh();
    } else if (res.ok && d.submission?.status === "REVIEW_REQUIRED") {
      toast("Identity leakage detected — held for review, not sent to the model.", "info");
      router.refresh();
    } else {
      toast(d.submission?.error ?? d.error ?? "Evaluation failed", "error");
      router.refresh();
    }
  }

  async function rerun(id: string) {
    setRerunId(id);
    const res = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: id }) });
    const d = await res.json().catch(() => ({}));
    setRerunId(null);
    if (res.ok) { toast("Re-evaluated", "success"); router.refresh(); }
    else toast(d.error ?? "Re-run failed", "error");
  }

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Evaluations</h1>
        <p className="mt-1 text-sm text-ink-2">Score a repository against the rubric, then review results.</p>
      </header>

      {/* Command panel */}
      <section className="card mb-8 overflow-hidden delay-1 fade-in-up">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-surface-2 px-4 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Evaluate a repository</h2>
        </div>
        <div className="p-4">
          {teams.length === 0 ? (
            <p className="text-sm text-ink-2">Add a team first on the <Link href="/organizer/teams" className="link-brand">Teams</Link> page.</p>
          ) : (
            <form onSubmit={evaluate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="sm:w-56">
                <span className="label">Team</span>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="field">
                  {teams.map((t) => (<option key={t.id} value={t.id}>{t.teamCode} — {t.name}</option>))}
                </select>
              </label>
              <label className="flex-1">
                <span className="label">GitHub repository URL</span>
                <input className="field mono" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/team/project" inputMode="url" />
              </label>
              <button type="submit" disabled={running} className="btn-primary shrink-0">
                {running ? "Evaluating…" : "Evaluate"}
              </button>
            </form>
          )}
          {running && (
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
              Fetching repository evidence and scoring with Claude — usually 15–40 seconds.
            </div>
          )}
        </div>
      </section>

      {/* Submissions */}
      {initialSubmissions.length === 0 ? (
        <EmptyState icon="evaluations" title="No evaluations yet" description="Run an evaluation above and results will appear here." />
      ) : (
        <div className="card overflow-hidden delay-2 fade-in-up">
          <div className="hidden grid-cols-[1.4fr_0.8fr_1.5fr_0.9fr_0.9fr_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
            <span>Team</span><span>Track</span><span>Repository</span><span>Status</span><span className="text-right">Score</span><span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            {initialSubmissions.map((s) => (
              <div key={s.id} className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[1.4fr_0.8fr_1.5fr_0.9fr_0.9fr_auto] sm:items-center sm:gap-4">
                <div>
                  <div className="font-semibold text-ink">{s.teamName}</div>
                  <div className="mono text-xs text-ink-3">{s.teamCode}</div>
                </div>
                <div><span className="chip">{s.track}</span></div>
                <div className="min-w-0">
                  <a href={s.repoUrl} target="_blank" className="mono flex items-center gap-1 truncate text-xs text-ink-2 hover:text-ink">
                    {repoShort(s.repoUrl)}<Icon.external size={11} />
                  </a>
                </div>
                <div>
                  <StatusBadge status={s.status} />
                  {s.status === "FAILED" && s.error && <div className="mt-0.5 max-w-[240px] truncate text-[11px] text-bad" title={s.error}>{s.error}</div>}
                </div>
                <div className="sm:text-right">
                  <div className="nums text-sm font-bold text-ink">{fmt(s.totalScore)}<span className="font-normal text-ink-3"> /100</span></div>
                  {s.totalScore != null && <ProgressBar value={s.totalScore} color={totalBandVar(s.totalScore)} className="mt-1.5 sm:ml-auto sm:w-20" />}
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <Link href={`/organizer/submissions/${s.id}`} className="link-brand text-xs">Details</Link>
                  <button onClick={() => rerun(s.id)} disabled={rerunId === s.id || s.status === "EVALUATING"} className="text-xs font-medium text-ink-2 hover:text-ink disabled:opacity-40">
                    {rerunId === s.id ? "Running…" : "Re-run"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

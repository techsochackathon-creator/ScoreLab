import Link from "next/link";
import type { JudgingProgress } from "@/lib/officialResults";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * Overall judging progress (organizer only). Counts come from judgingProgress(),
 * which uses the same live results finalization validates, so the "missing"
 * list is exactly what blocks finalization for lack of a submitted evaluation.
 */
export function JudgingProgressPanel({ progress, finalized, readinessLink = true }: { progress: JudgingProgress; finalized: boolean; readinessLink?: boolean }) {
  if (finalized) {
    return (
      <section className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span className="status-pill status-completed">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />Judging finalized
        </span>
        <span className="text-ink-2">Evaluations, assignments, teams and the rubric are locked.</span>
        <Link href="/organizer/results" className="link-brand ml-auto text-xs">View final results →</Link>
      </section>
    );
  }

  const stat = (label: string, value: number, warn = false) => (
    <div>
      <dd className="nums text-xl font-semibold leading-none" style={warn && value > 0 ? { color: "var(--warn-text)" } : undefined}>{value}</dd>
      <dt className="mt-1 text-xs text-ink-3">{label}</dt>
    </div>
  );

  return (
    <section className="card mb-4 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="section-title">Judging progress</h2>
        {readinessLink && <Link href="/organizer/results" className="link-brand text-xs">Finalization readiness →</Link>}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stat("Total teams", progress.totalTeams)}
        {stat("With a submitted evaluation", progress.withSubmitted)}
        {stat("Drafts only", progress.draftsOnly, true)}
        {stat("No evaluation", progress.noEvaluation, true)}
      </dl>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-ink-2">
          <span>Teams complete</span>
          <span className="nums font-semibold text-ink">{progress.percent}%</span>
        </div>
        <ProgressBar value={progress.percent} height={6} label="Teams with a submitted evaluation" />
      </div>

      {progress.missing.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-semibold text-ink-2">Still missing a submitted evaluation ({progress.missing.length})</div>
          <ul className="divide-y divide-hair rounded-md border border-hair">
            {progress.missing.map((t) => (
              <li key={t.teamId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
                <span className="text-xs font-medium" style={{ color: "var(--warn-text)" }}>
                  {t.assignedJudges === 0
                    ? "No judge assigned"
                    : t.draftJudges > 0
                      ? `Draft only (${t.draftJudges} of ${t.assignedJudges} judge${t.assignedJudges === 1 ? "" : "s"})`
                      : `Not started (${t.assignedJudges} judge${t.assignedJudges === 1 ? "" : "s"} assigned)`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

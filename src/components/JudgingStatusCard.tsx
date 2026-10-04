import Link from "next/link";
import { LifecycleSteps } from "@/components/LifecycleSteps";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { JudgingProgress, OfficialState } from "@/lib/officialResults";

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Organizer dashboard summary of the official (judge-score) workflow.
 * Presentation only — every number comes from officialResults.ts.
 */
export function JudgingStatusCard(
  props:
    | { phase: "JUDGING_OPEN"; progress: JudgingProgress; blockers: number }
    | { phase: "FINALIZED"; state: OfficialState },
) {
  if (props.phase === "FINALIZED") {
    const { state } = props;
    const winner = state.snapshot.teams.find((t) => t.isWinner)!;
    return (
      <section className="card mb-4 overflow-hidden" aria-labelledby="judging-status">
        <div className="border-b border-hair px-5 py-3">
          <LifecycleSteps phase={state.publishedAt ? "PUBLISHED" : "FINALIZED"} />
        </div>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="rank-badge" aria-hidden>1</span>
          <div className="min-w-0 flex-1">
            <h2 id="judging-status" className="winner-eyebrow">{state.publishedAt ? "Results Published" : "Results Finalized"} · Winner</h2>
            <p className="mt-0.5 truncate text-lg font-semibold text-ink">
              {winner.teamName} <span className="mono text-xs font-normal text-ink-3">{winner.teamCode}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              Finalized {when(state.finalizedAt)}
              {state.publishedAt ? ` · published ${when(state.publishedAt)}` : " · not published yet"}
            </p>
          </div>
          <div className="text-right">
            <div className="score-lg">{winner.judgeScore.toFixed(2)}</div>
            <div className="mt-1 text-xs text-ink-3">final judge score</div>
          </div>
          <Link href="/organizer/results" className="btn-primary w-full sm:w-auto">{state.publishedAt ? "View results" : "Review & publish"}</Link>
        </div>
      </section>
    );
  }

  const { progress, blockers } = props;
  const ready = blockers === 0 && progress.totalTeams > 0;
  const figure = (label: string, value: number, warn = false) => (
    <div>
      <dd className="nums text-xl font-semibold leading-none" style={warn && value > 0 ? { color: "var(--warn-text)" } : undefined}>{value}</dd>
      <dt className="mt-1 text-xs text-ink-3">{label}</dt>
    </div>
  );
  return (
    <section className="card mb-4 overflow-hidden" aria-labelledby="judging-status">
      <div className="border-b border-hair px-5 py-3">
        <LifecycleSteps phase="JUDGING_OPEN" />
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="judging-status" className="text-lg font-semibold text-ink">Judging Open</h2>
              {progress.totalTeams > 0 && (
                <span className={`status-pill ${ready ? "status-completed" : "status-review"}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                  {ready ? "Ready to finalize" : `${blockers} blocking`}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {progress.totalTeams === 0
                ? "No teams have been added yet."
                : `${progress.withSubmitted} of ${progress.totalTeams} team${progress.totalTeams === 1 ? "" : "s"} have a submitted judge evaluation.`}
              {progress.totalTeams > 0 && (blockers === 0
                ? " Ready to finalize."
                : ` ${blockers} issue${blockers === 1 ? "" : "s"} blocking finalization.`)}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Link href="/organizer/judges" className="btn-ghost flex-1 sm:flex-none">Judges &amp; assignments</Link>
            <Link href="/organizer/results" className="btn-primary flex-1 sm:flex-none">{ready ? "Finalize results" : "Results & readiness"}</Link>
          </div>
        </div>

        {progress.totalTeams > 0 && (
          <div className="mt-4 border-t border-hair pt-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {figure("Total teams", progress.totalTeams)}
              {figure("Submitted", progress.withSubmitted)}
              {figure("Drafts only", progress.draftsOnly, true)}
              {figure("No evaluation", progress.noEvaluation, true)}
            </dl>
            <div className="mt-4 flex items-center gap-3">
              <ProgressBar value={progress.percent} height={6} label="Teams with a submitted evaluation" />
              <span className="nums shrink-0 text-sm font-semibold text-ink">{progress.percent}%</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

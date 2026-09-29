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
      <section className="card mb-4 p-5" aria-labelledby="judging-status">
        <LifecycleSteps phase={state.publishedAt ? "PUBLISHED" : "FINALIZED"} className="mb-3" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="judging-status" className="text-lg font-bold text-ink">{state.publishedAt ? "Results Published" : "Results Finalized"}</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              Winner: <span className="font-semibold text-ink">{winner.teamName}</span> <span className="mono text-xs text-ink-3">{winner.teamCode}</span>{" "}
              · <span className="nums font-semibold text-ink">{winner.judgeScore.toFixed(2)}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              Finalized {when(state.finalizedAt)}
              {state.publishedAt ? ` · published ${when(state.publishedAt)}` : " · not published yet"}
            </p>
          </div>
          <Link href="/organizer/results" className="btn-primary">{state.publishedAt ? "View results" : "Review & publish"}</Link>
        </div>
      </section>
    );
  }

  const { progress, blockers } = props;
  return (
    <section className="card mb-4 p-5" aria-labelledby="judging-status">
      <LifecycleSteps phase="JUDGING_OPEN" className="mb-3" />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="judging-status" className="text-lg font-bold text-ink">Judging Open</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {progress.totalTeams === 0
              ? "No teams have been added yet."
              : `${progress.withSubmitted} of ${progress.totalTeams} team${progress.totalTeams === 1 ? "" : "s"} have a submitted judge evaluation.`}
            {progress.totalTeams > 0 && (blockers === 0
              ? " Ready to finalize."
              : ` ${blockers} issue${blockers === 1 ? "" : "s"} blocking finalization.`)}
          </p>
          {progress.totalTeams > 0 && (
            <ProgressBar value={progress.percent} height={6} className="mt-3 max-w-md" label="Teams with a submitted evaluation" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/organizer/judges" className="btn-ghost">Judges &amp; assignments</Link>
          <Link href="/organizer/results" className="btn-primary">{blockers === 0 && progress.totalTeams > 0 ? "Finalize results" : "Results & readiness"}</Link>
        </div>
      </div>
    </section>
  );
}

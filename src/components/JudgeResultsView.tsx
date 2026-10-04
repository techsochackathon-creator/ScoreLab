import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { totalBandVar } from "@/components/ui/ProgressBar";
import type { JudgeResults } from "@/lib/judgeResults";
import { officialStatus, type OfficialStatus } from "@/lib/officialResults";
import { ResultsLifecycleControl } from "@/components/ResultsLifecycleControl";
import { JudgingProgressPanel } from "@/components/JudgingProgressPanel";
import { DisqualifyPanel } from "@/components/DisqualifyPanel";
import type { JudgingProgress } from "@/lib/officialResults";

const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(2));

const STATUS_LABEL: Record<OfficialStatus, { label: string; pill: string }> = {
  WINNER: { label: "Leader", pill: "status-review" },
  TIED_FIRST: { label: "Tied for 1st", pill: "status-review" },
  RANKED: { label: "Ranked", pill: "status-queued" },
  NOT_EVALUATED: { label: "Not Evaluated", pill: "status-queued" },
};

/** Live results while judging is open. After finalization the page shows FinalResultsView instead. */
export function JudgeResultsView({ results, blockers, progress }: { results: JudgeResults; blockers: string[]; progress: JudgingProgress }) {
  const byId = new Map(results.ranked.map((t) => [t.teamId, t]));
  const top = results.topTeamIds.map((id) => byId.get(id)!).filter(Boolean);
  const winner = results.winnerTeamId ? byId.get(results.winnerTeamId) ?? null : null;

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="page-title">Official Results</h1>
        <p className="page-sub">
          Official score = average of each team&apos;s <span className="text-ink">submitted</span> judge evaluations (2 dp). The highest score wins. Drafts and AI scores are not used.
        </p>
      </header>

      <ResultsLifecycleControl phase="JUDGING_OPEN" blockers={blockers} />

      <JudgingProgressPanel progress={progress} finalized={false} readinessLink={false} />

      <DisqualifyPanel
        teams={[...results.ranked, ...results.incomplete].map((t) => ({ teamId: t.teamId, teamCode: t.teamCode, name: t.name })).sort((a, b) => a.teamCode.localeCompare(b.teamCode))}
        disqualified={results.disqualified.map((t) => ({ teamId: t.teamId, teamCode: t.teamCode, name: t.name, reason: t.reason }))}
      />

      <h2 className="mb-3 mt-6 section-title">Live standings (not final)</h2>

      {/* ── Winner / tie ── */}
      {results.status === "WINNER" && winner && (
        <section className="winner-card mb-4 flex flex-wrap items-center gap-4 p-5" aria-label="Current leader">
          <span className="rank-badge" aria-hidden>1</span>
          <div className="min-w-0 flex-1 basis-48">
            <div className="winner-eyebrow">Current leader — not final until finalized</div>
            <div className="mt-0.5 break-words text-xl font-semibold text-ink">{winner.name}</div>
            <div className="mt-0.5 text-xs text-ink-3">
              <span className="mono">{winner.teamCode}</span> · {winner.submittedJudges} judge{winner.submittedJudges === 1 ? "" : "s"} submitted
            </div>
          </div>
          <div className="text-right">
            <div className="score-lg">{fmt(winner.judgeScore)}</div>
            <div className="mt-1 text-xs text-ink-3">official judge score</div>
          </div>
        </section>
      )}

      {results.status === "TIE" && (
        <section className="card mb-4 p-5" style={{ borderColor: "rgb(var(--warn-rgb) / 0.45)", borderLeft: "3px solid var(--warn)" }}>
          <div className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--warn-text)" }}>⚠ TIE — WINNER NOT DETERMINED</div>
          <p className="mt-1 text-sm text-ink-2">
            {top.length} teams share the highest official judge score. No winner is selected, and results cannot be finalized while first place is tied.
          </p>
          <ul className="mt-3 divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)]">
            {top.map((t) => (
              <li key={t.teamId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.name}</span>
                <span className="nums font-semibold text-ink">{fmt(t.judgeScore)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Ranked teams ── */}
      {results.ranked.length === 0 ? (
        <EmptyState icon="leaderboard" title="No evaluations have been submitted yet." description="Standings appear here as judges submit their evaluations. Assign teams to judges on the Judges page." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--glass-border)] text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2.5 w-16">Rank</th>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5 text-right">Official Judge Score</th>
                  <th className="px-4 py-2.5 text-right">Judges Submitted</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)]">
                {results.ranked.map((t) => (
                  <tr key={t.teamId} className={results.winnerTeamId === t.teamId ? "row-winner" : "transition-colors hover:bg-surface-2"}>
                    <td className="px-4 py-2.5 nums font-semibold text-ink">
                      {t.rank}
                      {t.tiedWith.length > 0 && (
                        <span className="ml-1.5 rounded border border-warn/40 px-1 py-0.5 text-[10px] font-bold" style={{ color: "var(--warn-text)" }}>TIE</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="mono text-xs text-ink-3">{t.teamCode}</span>
                      <span className="ml-2 font-medium text-ink">{t.name}</span>
                      {results.winnerTeamId === t.teamId && (
                        <span className="tag-gold">LEADER</span>
                      )}
                      {t.projectTitle && <div className="text-xs text-ink-3">{t.projectTitle}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right nums text-base font-semibold" style={{ color: totalBandVar(t.judgeScore!) }}>{fmt(t.judgeScore)}</td>
                    <td className="px-4 py-2.5 text-right nums text-ink-2">
                      <span className="font-semibold text-ink">{t.submittedJudges}</span>
                      {t.assignedJudges > 0 && <span className="text-ink-3"> of {t.assignedJudges} assigned</span>}
                      {t.draftJudges > 0 && <div className="text-[11px] text-ink-3">{t.draftJudges} draft{t.draftJudges === 1 ? "" : "s"} pending</div>}
                    </td>
                    <td className="px-4 py-2.5"><StatusPill status={officialStatus(results, t.teamId)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Incomplete ── */}
      {results.incomplete.length > 0 && (
        <section className="mt-6">
          <SectionTitle>Not Evaluated · not ranked ({results.incomplete.length})</SectionTitle>
          <div className="card divide-y divide-[var(--glass-border)]">
            {results.incomplete.map((t) => (
              <div key={t.teamId} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <span className="mono w-28 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{t.name}</span>
                <StatusPill status="NOT_EVALUATED" />
                <span className="text-xs text-ink-3">
                  {t.assignedJudges === 0
                    ? "No judges assigned"
                    : `0 of ${t.assignedJudges} submitted${t.draftJudges ? ` · ${t.draftJudges} draft${t.draftJudges === 1 ? "" : "s"}` : ""}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: OfficialStatus }) {
  const s = STATUS_LABEL[status];
  return (
    <span className={`status-pill ${s.pill}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {s.label}
    </span>
  );
}

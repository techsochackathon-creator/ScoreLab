import type { OfficialState } from "@/lib/officialResults";
import { ResultsLifecycleControl } from "@/components/ResultsLifecycleControl";

const fmt = (n: number) => n.toFixed(2);

/** Finalized official result — rendered from the frozen snapshot only. Read-only by design. */
export function FinalResultsView({ state }: { state: OfficialState }) {
  const { snapshot } = state;
  const winner = snapshot.teams.find((t) => t.isWinner)!;

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Official Results</h1>
        <p className="mt-1 text-sm text-ink-2">Final ranking by average submitted judge score. This result is frozen and no longer depends on live judge data.</p>
      </header>

      <ResultsLifecycleControl
        phase={state.publishedAt ? "PUBLISHED" : "FINALIZED"}
        finalizedAt={state.finalizedAt.toISOString()}
        publishedAt={state.publishedAt?.toISOString() ?? null}
      />

      <section className="card mb-4 flex flex-wrap items-center gap-4 p-5" style={{ borderColor: "rgba(251, 191, 36, 0.35)" }}>
        <span className="grid h-11 w-11 place-items-center rounded-full text-lg font-bold text-white" style={{ background: "var(--gold)" }}>1</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>Winner</div>
          <div className="text-lg font-bold text-ink"><span className="mono">{winner.teamCode}</span> · {winner.teamName}</div>
        </div>
        <div className="nums text-2xl font-bold text-ink">{fmt(winner.judgeScore)}</div>
      </section>

      {(snapshot.disqualified?.length ?? 0) > 0 && (
        <section className="card mb-4 p-4" aria-label="Disqualified teams">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">Disqualified — not ranked</div>
          <ul className="divide-y divide-[var(--glass-border)]">
            {snapshot.disqualified!.map((t) => (
              <li key={t.teamId} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{t.teamName}</span>
                <span className="status-pill status-failed">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                  Disqualified
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--glass-border)] text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                <th className="px-5 py-3 w-16">Rank</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3 text-right">Final Judge Score</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {snapshot.teams.map((t) => (
                <tr key={t.teamId}>
                  <td className="px-5 py-3 nums font-semibold text-ink">{t.rank}</td>
                  <td className="px-5 py-3">
                    <span className="mono text-xs text-ink-3">{t.teamCode}</span>
                    <span className="ml-2 font-medium text-ink">{t.teamName}</span>
                  </td>
                  <td className="px-5 py-3 text-right nums text-base font-semibold text-ink">{fmt(t.judgeScore)}</td>
                  <td className="px-5 py-3">
                    <span className={`status-pill ${t.isWinner ? "status-completed" : "status-queued"}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                      {t.isWinner ? "Winner" : "Ranked"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

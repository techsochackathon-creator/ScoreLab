import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { prisma } from "@/lib/prisma";
import { getPublicResults } from "@/lib/officialResults";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard — ScoreLab" };

const fmt = (n: number) => n.toFixed(2);

/**
 * Public official results (no auth). Judge scores only — never AI scores,
 * judge identities, individual judge scores or drafts. Shown only after the
 * organizer publishes.
 */
export default async function LeaderboardPage() {
  const results = await getPublicResults(prisma);

  return (
    <div className="min-h-screen bg-bg ambient-glow">
      <div className="relative z-10 mx-auto max-w-3xl px-5 py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-extrabold"
              style={{ background: "var(--gradient-brand)", color: "var(--brand-fg)", boxShadow: "var(--glow-brand-sm)" }}
            >
              S
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ink">
              Score<span style={{ color: "var(--brand)" }}>Lab</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>

        <header className="mb-8 mt-10 fade-in-up">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Leaderboard</h1>
          <p className="mt-1.5 text-sm text-ink-2">Official results — teams ranked by their average judge score, out of 100.</p>
        </header>

        {!results.published ? (
          <div className="card px-6 py-16 text-center fade-in-up">
            <div className="text-base font-semibold text-ink">No published results</div>
            <p className="mt-2 text-sm text-ink-3">The leaderboard will appear once the organizer publishes the official results.</p>
          </div>
        ) : (
          <div className="fade-in-up delay-2">
            {results.winner && (
              <section className="card mb-4 flex items-center gap-4 p-5" style={{ borderColor: "rgba(251, 191, 36, 0.35)" }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold text-white" style={{ background: "var(--gold)" }}>1</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>Winner</div>
                  <div className="truncate text-lg font-bold text-ink">{results.winner.teamName}</div>
                  <div className="mono text-xs text-ink-3">{results.winner.teamCode}</div>
                </div>
                <div className="nums text-2xl font-bold text-ink">{fmt(results.winner.judgeScore)}</div>
              </section>
            )}

            {results.status === "TIE" && (
              <section className="card mb-4 p-5" style={{ borderColor: "rgba(245, 158, 11, 0.45)" }}>
                <div className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--warn)" }}>Tie for first place</div>
                <p className="mt-1 text-sm text-ink-2">
                  {results.tiedForFirst.map((t) => t.teamName).join(" and ")} share the highest score ({fmt(results.tiedForFirst[0].judgeScore)}). Final winner determination is pending.
                </p>
              </section>
            )}

            {results.rows.length === 0 ? (
              <div className="card px-6 py-16 text-center text-sm text-ink-3">No evaluated teams yet.</div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--glass-border)] text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                      <th className="px-5 py-3 w-16">Rank</th>
                      <th className="px-5 py-3">Team</th>
                      <th className="px-5 py-3 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--glass-border)]">
                    {results.rows.map((r) => (
                      <tr key={r.teamCode}>
                        <td className="px-5 py-3 nums font-semibold text-ink">{r.rank}</td>
                        <td className="px-5 py-3">
                          <span className="font-medium text-ink">{r.teamName}</span>
                          <span className="mono ml-2 text-xs text-ink-3">{r.teamCode}</span>
                          {r.status === "WINNER" && (
                            <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: "var(--gold)" }}>WINNER</span>
                          )}
                          {r.status === "TIED_FIRST" && (
                            <span className="ml-2 rounded border border-warn/40 px-1 py-0.5 text-[10px] font-bold" style={{ color: "var(--warn)" }}>TIED</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right nums text-base font-semibold text-ink">{fmt(r.judgeScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {results.notEvaluated.length > 0 && (
              <p className="mt-4 text-xs text-ink-3">
                Not evaluated: {results.notEvaluated.map((t) => t.teamName).join(", ")}
              </p>
            )}

            <p className="mt-4 text-center text-xs text-ink-3">
              Published {results.publishedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

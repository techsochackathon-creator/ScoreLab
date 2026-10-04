import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { prisma } from "@/lib/prisma";
import { getPublicResults } from "@/lib/officialResults";

export const dynamic = "force-dynamic";
export const metadata = { title: "Official Results — ScoreLab" };

const fmt = (n: number) => n.toFixed(2);

/**
 * Public official results (no auth), read from the FINALIZED snapshot — never
 * from live judge data, so it cannot drift. Judge scores only — never AI scores,
 * judge identities, individual judge scores or drafts. Shown only after the
 * organizer finalizes and publishes. Nothing is calculated here.
 */
export default async function LeaderboardPage() {
  const results = await getPublicResults(prisma);

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-5 sm:py-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="ScoreLab home"><Logo /></Link>
          <ThemeToggle />
        </div>

        <header className="mb-5 mt-8 sm:mt-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Official Results</h1>
            <span className={`status-pill ${results.published ? "status-completed" : "status-queued"}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
              {results.published ? "Final" : "Pending"}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-ink-2">Final ranking by average judge score, out of 100.</p>
        </header>

        {!results.published ? (
          <div className="card px-6 py-12 text-center">
            <div className="card-title">Results have not been published yet.</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">The official results will appear here once judging is finalized and the organizer publishes them.</p>
          </div>
        ) : (
          <>
            <section className="winner-card mb-4 flex flex-wrap items-center gap-4 p-5 sm:p-6" aria-label="Winner">
              <span className="rank-badge" aria-hidden>1</span>
              <div className="min-w-0 flex-1 basis-40">
                <div className="winner-eyebrow">Winner</div>
                <div className="mt-0.5 break-words text-xl font-semibold text-ink sm:text-2xl">{results.winner.teamName}</div>
                <div className="mono mt-0.5 text-xs text-ink-3">{results.winner.teamCode}</div>
              </div>
              <div className="text-right">
                <div className="score-lg">
                  {fmt(results.winner.judgeScore)}
                  <span className="ml-0.5 text-sm font-normal text-ink-3">/100</span>
                </div>
                <div className="mt-1 text-xs text-ink-3">final score</div>
              </div>
            </section>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Final ranking</caption>
                  <thead>
                    <tr className="border-b border-[var(--glass-border)] text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                      <th scope="col" className="w-16 px-4 py-3 sm:px-5">Rank</th>
                      <th scope="col" className="px-4 py-3 sm:px-5">Team</th>
                      <th scope="col" className="px-4 py-3 text-right sm:px-5">Final score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--glass-border)]">
                    {results.rows.map((r) => (
                      <tr key={r.teamCode} className={r.status === "WINNER" ? "row-winner" : undefined}>
                        <td className="nums px-4 py-3 font-semibold text-ink sm:px-5">{r.rank}</td>
                        <td className="px-4 py-3 sm:px-5">
                          <span className="font-medium text-ink">{r.teamName}</span>
                          <span className="mono ml-2 whitespace-nowrap text-xs text-ink-3">{r.teamCode}</span>
                          {r.status === "WINNER" && (
                            <span className="tag-gold">WINNER</span>
                          )}
                        </td>
                        <td className="nums px-4 py-3 text-right text-base font-semibold text-ink sm:px-5">{fmt(r.judgeScore)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {results.disqualified.length > 0 && (
              <section className="card mt-4 p-4" aria-label="Disqualified teams">
                <h2 className="mb-1.5 section-title">Disqualified teams</h2>
                <ul className="divide-y divide-[var(--glass-border)]">
                  {results.disqualified.map((t) => (
                    <li key={t.teamCode} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                      <span className="text-ink-2">{t.teamName}</span>
                      <span className="mono whitespace-nowrap text-xs text-ink-3">{t.teamCode}</span>
                      <span className="ml-auto text-xs text-ink-3">Not ranked</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="mt-4 text-center text-xs text-ink-3">
              Final results · published {results.publishedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

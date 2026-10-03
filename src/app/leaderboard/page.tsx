import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
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
          <Link href="/" className="flex items-center gap-2.5" aria-label="ScoreLab home">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-extrabold"
              style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
              aria-hidden
            >
              S
            </span>
            <span className="text-[15px] font-bold tracking-tight text-ink">
              Score<span style={{ color: "var(--brand)" }}>Lab</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>

        <header className="mb-6 mt-8 sm:mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Official Results</h1>
          <p className="mt-1.5 text-sm text-ink-2">Final ranking by average judge score, out of 100.</p>
        </header>

        {!results.published ? (
          <div className="card px-6 py-14 text-center">
            <div className="text-base font-semibold text-ink">Results have not been published yet.</div>
            <p className="mt-2 text-sm text-ink-3">The official results will appear here once judging is finalized and the organizer publishes them.</p>
          </div>
        ) : (
          <>
            <section
              className="card mb-4 flex flex-wrap items-center gap-4 p-5"
              style={{ borderColor: "rgba(251, 191, 36, 0.45)" }}
              aria-label="Winner"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold text-white" style={{ background: "var(--gold)" }} aria-hidden>
                1
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>Winner</div>
                <div className="break-words text-lg font-bold text-ink">{results.winner.teamName}</div>
                <div className="mono text-xs text-ink-3">{results.winner.teamCode}</div>
              </div>
              <div className="nums text-2xl font-bold text-ink">
                {fmt(results.winner.judgeScore)}
                <span className="ml-0.5 text-sm font-normal text-ink-3">/100</span>
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
                      <tr key={r.teamCode}>
                        <td className="nums px-4 py-3 font-semibold text-ink sm:px-5">{r.rank}</td>
                        <td className="px-4 py-3 sm:px-5">
                          <span className="font-medium text-ink">{r.teamName}</span>
                          <span className="mono ml-2 whitespace-nowrap text-xs text-ink-3">{r.teamCode}</span>
                          {r.status === "WINNER" && (
                            <span className="ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: "var(--gold)" }}>WINNER</span>
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
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">Disqualified teams</div>
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

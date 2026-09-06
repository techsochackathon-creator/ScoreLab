import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LeaderboardTable, type LeaderRow } from "@/components/LeaderboardTable";
import { getPublishedSnapshot } from "@/lib/evalRunEngine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard — ScoreLab" };

export default async function LeaderboardPage() {
  const published = await getPublishedSnapshot();

  // Build rows from the published snapshot only.
  let rows: LeaderRow[] = [];
  let runName: string | null = null;

  if (published) {
    runName = published.run.name;
    rows = published.snapshot.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      university: t.university,
      track: t.track,
      totalScore: t.totalScore,
      trend: null, // snapshot is frozen — no trend
      rank: t.rank,
      tieBreakMethod: t.tieBreakMethod ?? null,
    }));
    // Sort by rank (unique ranks from tie resolution), not just score.
    rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }

  const tracks = [...new Set(rows.map((r) => r.track))].sort();

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
          <div className="flex items-center gap-3">
            <Link href="/organizer/dashboard" className="link text-sm">Organizer</Link>
            <ThemeToggle />
          </div>
        </div>

        <header className="mb-8 mt-10 fade-in-up">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Leaderboard</h1>
          {published ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>Teams ranked by AI-scored weighted total, out of 100.</span>
              {runName && (
                <span className="chip">{runName}</span>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-ink-2">Teams ranked by AI-scored weighted total, out of 100.</p>
          )}
        </header>

        {!published ? (
          <div className="card px-6 py-16 text-center fade-in-up">
            <div className="text-base font-semibold text-ink">No published results</div>
            <p className="mt-2 text-sm text-ink-3">
              The leaderboard will appear once the organizer finalizes and publishes an evaluation run.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="card px-6 py-16 text-center text-sm text-ink-3">No evaluated teams in this run.</div>
        ) : (
          <div className="fade-in-up delay-2">
            <LeaderboardTable rows={rows} tracks={tracks} />
          </div>
        )}

        {published?.run.publishedAt && (
          <p className="mt-4 text-center text-xs text-ink-3">
            Published {new Date(published.run.publishedAt).toLocaleDateString("en-US", {
              month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </p>
        )}
      </div>
    </div>
  );
}

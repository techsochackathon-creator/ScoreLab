import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getTrackLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trackId: string }>;
}): Promise<Metadata> {
  const { trackId } = await params;
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  return { title: track ? `${track.name} — Leaderboard` : "Leaderboard" };
}

/**
 * PUBLIC leaderboard — no auth. Renders only when the organizer has published
 * the track (Track.publishedAt set). Shows ranks and scores, not internal logs.
 */
export default async function PublicLeaderboardPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track || !track.publishedAt) notFound();

  const board = await getTrackLeaderboard(trackId);
  if (!board) notFound();

  const ranked = board.entries.filter((e) => e.evaluated);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 text-center">
        <p className="text-sm uppercase tracking-wide text-indigo-600">
          Hackathon Leaderboard
        </p>
        <h1 className="mt-1 text-3xl font-bold">{board.trackName}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Published {new Date(track.publishedAt).toLocaleDateString()} ·{" "}
          <Link href="/methodology" className="text-indigo-600 hover:underline">
            How scoring works
          </Link>
        </p>
      </header>

      {ranked.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No evaluated submissions.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {ranked.map((e) => (
            <li key={e.submissionId}>
              <Link
                href={`/leaderboard/${trackId}/${e.teamId}`}
                className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-3 transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-gray-800 dark:hover:bg-indigo-950/30"
              >
                <span className="w-8 text-center text-xl font-bold tabular-nums text-gray-400">
                  {e.rank}
                </span>
                <div className="flex-1">
                  <div className="font-semibold">{e.teamName}</div>
                  <div className="text-xs text-gray-500">{e.university}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums">
                    {fmt(e.finalScore)}
                  </div>
                  <div className="text-[10px] uppercase text-gray-400">score</div>
                </div>
                <span className="text-gray-300">›</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

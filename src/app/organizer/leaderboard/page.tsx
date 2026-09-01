import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTrackLeaderboard } from "@/lib/leaderboard";
import { Leaderboard } from "@/components/Leaderboard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") {
    redirect("/login?error=forbidden");
  }

  const tracks = await prisma.track.findMany({ orderBy: { name: "asc" } });
  const initial =
    tracks.length > 0 ? await getTrackLeaderboard(tracks[0].id) : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Ranked per track. Final score blends automated criteria with the
            organizer&apos;s judge score by rubric weight.
          </p>
        </div>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Home
        </Link>
      </div>

      {tracks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No tracks yet.
        </p>
      ) : (
        <Leaderboard
          tracks={tracks.map((t) => ({ id: t.id, name: t.name }))}
          initialTrackId={tracks[0].id}
          initialData={initial}
        />
      )}
    </main>
  );
}

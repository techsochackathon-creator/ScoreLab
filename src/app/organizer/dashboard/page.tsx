import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTrackDashboard } from "@/lib/dashboard";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") {
    redirect("/login?error=forbidden");
  }

  const tracks = await prisma.track.findMany({ orderBy: { name: "asc" } });
  const initial =
    tracks.length > 0 ? await getTrackDashboard(tracks[0].id) : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evaluation dashboard</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Job status, per-team scores, re-runs, judging, and publishing.
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/organizer/rubrics" className="text-indigo-600 hover:underline">
            Rubrics
          </Link>
          <Link href="/organizer/leaderboard" className="text-indigo-600 hover:underline">
            Leaderboard
          </Link>
        </nav>
      </div>

      {tracks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No tracks yet.
        </p>
      ) : (
        <Dashboard
          tracks={tracks.map((t) => ({ id: t.id, name: t.name }))}
          initialTrackId={tracks[0].id}
          initialData={initial}
        />
      )}
    </main>
  );
}

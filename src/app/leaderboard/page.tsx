import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboards" };

/** Public index of published track leaderboards. */
export default async function LeaderboardIndex() {
  const tracks = await prisma.track.findMany({
    where: { publishedAt: { not: null } },
    orderBy: { name: "asc" },
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold">Leaderboards</h1>
        <p className="mt-1 text-sm text-gray-500">
          <Link href="/methodology" className="text-indigo-600 hover:underline">
            How scoring works
          </Link>
        </p>
      </header>

      {tracks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No leaderboards have been published yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tracks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/leaderboard/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:border-indigo-400 dark:border-gray-800"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-gray-300">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

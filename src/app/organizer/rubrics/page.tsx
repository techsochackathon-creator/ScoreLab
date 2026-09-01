import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRubricLockState } from "@/lib/rubricLock";
import { RubricEditor, type TrackRubric } from "@/components/RubricEditor";

export const dynamic = "force-dynamic";

export default async function OrganizerRubricsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ORGANIZER") {
    redirect("/login?error=forbidden");
  }

  const tracks = await prisma.track.findMany({
    orderBy: { name: "asc" },
    include: {
      rubrics: {
        take: 1,
        include: { criteria: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  const initialTracks: TrackRubric[] = await Promise.all(
    tracks.map(async (t) => {
      const rubric = t.rubrics[0];
      return {
        trackId: t.id,
        trackName: t.name,
        rubricName: rubric?.name ?? `${t.name} Rubric`,
        lock: await getRubricLockState(t.id),
        criteria: (rubric?.criteria ?? []).map((c) => ({
          name: c.name,
          checkType: c.checkType,
          weightPercent: Math.round(c.weight * 1000) / 10,
          scoringRules: c.scoringRules,
        })),
      };
    }),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rubrics</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Define weighted, automated evaluation criteria per track.
          </p>
        </div>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Home
        </Link>
      </div>

      {initialTracks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No tracks yet. Seed the database (<code>npm run db:seed</code>) or
          create tracks first.
        </p>
      ) : (
        <RubricEditor initialTracks={initialTracks} />
      )}
    </main>
  );
}

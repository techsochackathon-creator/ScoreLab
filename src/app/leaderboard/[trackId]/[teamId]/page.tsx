import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamResults } from "@/lib/publicResults";
import { CriterionCard } from "@/components/CriterionEvidence";

export const dynamic = "force-dynamic";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trackId: string; teamId: string }>;
}): Promise<Metadata> {
  const { trackId, teamId } = await params;
  const r = await getTeamResults(trackId, teamId);
  return { title: r ? `${r.teamName} — Results` : "Results" };
}

export default async function TeamResultsPage({
  params,
}: {
  params: Promise<{ trackId: string; teamId: string }>;
}) {
  const { trackId, teamId } = await params;
  const results = await getTeamResults(trackId, teamId);
  if (!results) notFound();

  // Visible when the track is published, or to an organizer, or to a member of
  // this team (teams can see their own breakdown before publication).
  const session = await getServerSession(authOptions);
  const allowed =
    results.trackPublished ||
    session?.user.role === "ORGANIZER" ||
    session?.user.teamId === teamId;
  if (!allowed) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/leaderboard/${trackId}`}
        className="text-sm text-indigo-600 hover:underline"
      >
        ← {results.trackName} leaderboard
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-bold">{results.teamName}</h1>
        <p className="text-sm text-gray-500">
          {results.university} · {results.trackName}
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {results.repoUrl && (
            <a href={results.repoUrl} target="_blank" className="text-indigo-600 hover:underline">
              Repo ↗
            </a>
          )}
          {results.liveUrl && (
            <a href={results.liveUrl} target="_blank" className="text-indigo-600 hover:underline">
              Live URL ↗
            </a>
          )}
          <Link href="/methodology" className="text-indigo-600 hover:underline">
            How scoring works →
          </Link>
        </div>
      </header>

      {!results.evaluated ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          This submission hasn&apos;t completed evaluation yet.
        </p>
      ) : (
        <>
          <section className="mb-6 flex gap-8 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div>
              <div className="text-xs text-gray-500">Final score</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">
                {fmt(results.score?.finalScore)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Technical (automated)</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {fmt(results.score?.technicalScore)}
              </div>
            </div>
            {results.humanMaxScore != null && results.score?.humanScored && (
              <div>
                <div className="text-xs text-gray-500">
                  Judge /{results.humanMaxScore}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  {results.score?.humanScore ?? "—"}
                </div>
              </div>
            )}
          </section>

          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Criterion-by-criterion
          </h2>
          <div className="flex flex-col gap-4">
            {results.results.map((r) => (
              <CriterionCard key={r.criterionId} result={r} />
            ))}
          </div>
          <p className="mt-6 text-xs text-gray-500">
            Scores show points earned out of each criterion&apos;s maximum,
            weighted into the final score. Unmeasured checks (e.g. no live URL)
            count as zero. See the{" "}
            <Link href="/methodology" className="text-indigo-600 hover:underline">
              methodology
            </Link>{" "}
            for how each check works.
          </p>
        </>
      )}
    </main>
  );
}

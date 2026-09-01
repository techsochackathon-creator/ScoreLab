import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { explainCriterion } from "@/lib/methodology";
import type { CheckType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Scoring Methodology",
  description: "How submissions are evaluated and scored.",
};

/**
 * PUBLIC methodology page. Pulls live rubric criteria/weights/scoringRules from
 * the database and explains each automated check in plain language, so the docs
 * always match the actual scoring configuration.
 */
export default async function MethodologyPage() {
  const tracks = await prisma.track.findMany({
    orderBy: { name: "asc" },
    include: {
      rubrics: { take: 1, include: { criteria: { orderBy: { createdAt: "asc" } } } },
    },
  });

  const tracksWithRubric = tracks.filter((t) => t.rubrics[0]?.criteria.length);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Scoring methodology</h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Every submission is evaluated automatically in an isolated sandbox and
          against its live URL. Each track has its own rubric of weighted
          criteria; a criterion&apos;s score is the points it earns out of its
          maximum, multiplied by its weight. All weights in a rubric sum to
          100%. The automated result is the <strong>technical score</strong>;
          when a judge score is present it is blended in by its own weight to
          form the <strong>final score</strong>.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          Checks that can&apos;t be measured (for example, no live URL for a
          Lighthouse or uptime check) count as zero while keeping their weight.{" "}
          <Link href="/leaderboard" className="text-indigo-600 hover:underline">
            View leaderboards →
          </Link>
        </p>
      </header>

      {tracksWithRubric.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
          No rubrics have been configured yet.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {tracksWithRubric.map((track) => {
            const criteria = track.rubrics[0].criteria;
            const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
            return (
              <section key={track.id}>
                <h2 className="mb-1 text-xl font-bold">{track.name}</h2>
                <p className="mb-4 text-xs text-gray-500">
                  {criteria.length} criteria · weights total{" "}
                  {Math.round(totalWeight * 100)}%
                </p>
                <div className="flex flex-col gap-4">
                  {criteria.map((c) => {
                    const ex = explainCriterion(
                      c.checkType as CheckType,
                      c.scoringRules,
                      c.weight,
                    );
                    return (
                      <article
                        key={c.id}
                        className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-semibold">
                            {c.name}
                            <span className="ml-2 text-xs font-normal text-gray-500">
                              {ex.title}
                            </span>
                          </h3>
                          <div className="flex items-center gap-2 text-xs">
                            {!ex.automated && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                manual
                              </span>
                            )}
                            <span className="rounded bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                              {ex.weightPct}% weight
                            </span>
                          </div>
                        </div>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {ex.blurb}
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                          {ex.rules.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

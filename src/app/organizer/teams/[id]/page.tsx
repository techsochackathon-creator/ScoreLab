import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDataset, perCriterion } from "@/lib/stats";
import { TeamDetail, type TeamDetailData } from "@/components/TeamDetail";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      submissions: {
        orderBy: { createdAt: "desc" },
        include: { scores: { include: { criterion: true }, orderBy: { criterion: { order: "asc" } } } },
      },
      evaluationEvents: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!team) notFound();

  const latest = team.submissions.find((s) => s.status === "EVALUATED") ?? null;
  const ds = await getDataset();
  const ranked = [...ds.teams].sort((a, b) => b.totalScore - a.totalScore);
  const rank = ranked.findIndex((t) => t.teamId === team.id);
  const avgByCrit = perCriterion(ds);

  const data: TeamDetailData = {
    id: team.id,
    teamCode: team.teamCode,
    name: team.name,
    university: team.university,
    track: team.track,
    members: team.memberNames,
    projectTitle: team.projectTitle,
    projectDescription: team.projectDescription,
    technologies: team.technologies,
    status: latest?.status ?? (team.submissions[0]?.status ?? null),
    totalScore: latest?.totalScore ?? null,
    repoUrl: latest?.repoUrl ?? null,
    rank: rank >= 0 ? rank + 1 : null,
    rankOf: ranked.length,
    scores: (latest?.scores ?? []).map((s) => ({
      id: s.id,
      name: s.criterion.name,
      score: s.score,
      scaleMax: s.criterion.scaleMax,
      weight: s.criterion.weight,
      reasoning: s.reasoning,
    })),
    radar: latest
      ? {
          axes: latest.scores.map((s) => s.criterion.name),
          values: latest.scores.map((s) => s.score),
          scaleMax: latest.scores[0]?.criterion.scaleMax ?? 5,
          avg: latest.scores.map((s) => {
            const a = avgByCrit.find((x) => x.id === s.criterionId);
            return a ? a.rawAvg : 0;
          }),
        }
      : null,
    submissions: team.submissions.map((s) => ({
      id: s.id,
      status: s.status,
      totalScore: s.totalScore,
      repoUrl: s.repoUrl,
      createdAt: s.createdAt.toISOString(),
    })),
    history: team.evaluationEvents.map((e) => ({ id: e.id, totalScore: e.totalScore ?? 0, createdAt: e.createdAt.toISOString() })),
  };

  return (
    <div>
      <Link href="/organizer/teams" className="link text-sm">← Teams</Link>
      <TeamDetail data={data} />
    </div>
  );
}

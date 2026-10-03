import { prisma } from "@/lib/prisma";
import { EvaluationsView, type SubmissionRow, type TeamOption } from "@/components/EvaluationsView";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const [subs, teams] = await Promise.all([
    prisma.submission.findMany({ orderBy: { createdAt: "desc" }, include: { team: true } }),
    prisma.team.findMany({ orderBy: [{ track: "asc" }, { name: "asc" }] }),
  ]);

  const submissions: SubmissionRow[] = subs.map((s) => ({
    id: s.id,
    teamName: s.team.name,
    teamCode: s.team.teamCode,
    track: s.team.track,
    repoUrl: s.repoUrl,
    status: s.status,
    totalScore: s.totalScore,
    error: s.error,
  }));
  const teamOptions: TeamOption[] = teams.map((t) => ({ id: t.id, teamCode: t.teamCode, name: t.name }));

  return <EvaluationsView initialSubmissions={submissions} teams={teamOptions} />;
}

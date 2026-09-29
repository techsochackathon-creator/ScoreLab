import { prisma } from "@/lib/prisma";
import { isJudgingFinalized, listJudges } from "@/lib/judges";
import { getJudgeProgress, summarizeProgress } from "@/lib/judgeEvaluations";
import { getJudgeResults } from "@/lib/judgeResults";
import { judgingProgress } from "@/lib/officialResults";
import { JudgesManager, type JudgeRow, type TeamOption } from "@/components/JudgesManager";
import { JudgingProgressPanel } from "@/components/JudgingProgressPanel";

export const dynamic = "force-dynamic";

/** Organizer-only (middleware + organizer layout): judge accounts, assignments and judging progress. */
export default async function JudgesPage() {
  const [judges, teams, assignments, perJudge, results, finalized] = await Promise.all([
    listJudges(prisma),
    prisma.team.findMany({ orderBy: { teamCode: "asc" }, select: { id: true, teamCode: true, name: true } }),
    prisma.judgeAssignment.findMany({ select: { judgeId: true, teamId: true } }),
    getJudgeProgress(prisma),
    getJudgeResults(prisma),
    isJudgingFinalized(prisma),
  ]);

  const judgesPerTeam = new Map<string, number>();
  for (const a of assignments) judgesPerTeam.set(a.teamId, (judgesPerTeam.get(a.teamId) ?? 0) + 1);

  const rows: JudgeRow[] = judges.map((j) => {
    const p = perJudge.get(j.id);
    return {
      id: j.id,
      name: j.name,
      email: j.email,
      active: j.active,
      createdAt: j.createdAt.toISOString(),
      teamIds: Object.keys(p?.statusByTeam ?? {}),
      statusByTeam: p?.statusByTeam ?? {},
      progress: p?.progress ?? summarizeProgress([]),
    };
  });
  const teamOptions: TeamOption[] = teams.map((t) => ({ ...t, judgeCount: judgesPerTeam.get(t.id) ?? 0 }));

  return (
    <JudgesManager judges={rows} teams={teamOptions} finalized={finalized}>
      <JudgingProgressPanel progress={judgingProgress(results)} finalized={finalized} />
    </JudgesManager>
  );
}

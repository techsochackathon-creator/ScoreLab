import { prisma } from "@/lib/prisma";
import { listJudges } from "@/lib/judges";
import { JudgesManager, type JudgeRow, type TeamOption } from "@/components/JudgesManager";

export const dynamic = "force-dynamic";

/** Organizer-only (middleware + organizer layout): judge accounts and team assignments. */
export default async function JudgesPage() {
  const [judges, teams, assignments] = await Promise.all([
    listJudges(prisma),
    prisma.team.findMany({ orderBy: { teamCode: "asc" }, select: { id: true, teamCode: true, name: true } }),
    prisma.judgeAssignment.findMany({ select: { judgeId: true, teamId: true } }),
  ]);

  const byJudge = new Map<string, string[]>();
  for (const a of assignments) byJudge.set(a.judgeId, [...(byJudge.get(a.judgeId) ?? []), a.teamId]);

  const rows: JudgeRow[] = judges.map((j) => ({
    id: j.id,
    name: j.name,
    email: j.email,
    active: j.active,
    createdAt: j.createdAt.toISOString(),
    teamIds: byJudge.get(j.id) ?? [],
  }));
  const teamOptions: TeamOption[] = teams;

  return <JudgesManager judges={rows} teams={teamOptions} />;
}

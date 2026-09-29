import { prisma } from "@/lib/prisma";
import { isJudgingFinalized } from "@/lib/judges";
import { TeamsManager, type TeamRow } from "@/components/TeamsManager";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const [teams, locked] = await Promise.all([
    prisma.team.findMany({ orderBy: [{ track: "asc" }, { name: "asc" }] }),
    isJudgingFinalized(prisma),
  ]);
  const rows: TeamRow[] = teams.map((t) => ({
    id: t.id,
    teamCode: t.teamCode,
    name: t.name,
    university: t.university,
    track: t.track,
    memberNames: t.memberNames,
    projectTitle: t.projectTitle,
    technologies: t.technologies,
    repoUrl: t.repoUrl,
  }));
  return <TeamsManager initialTeams={rows} locked={locked} />;
}

import { prisma } from "@/lib/prisma";
import { TeamsManager, type TeamRow } from "@/components/TeamsManager";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({ orderBy: [{ track: "asc" }, { name: "asc" }] });
  const rows: TeamRow[] = teams.map((t) => ({
    id: t.id,
    teamCode: t.teamCode,
    name: t.name,
    university: t.university,
    track: t.track,
    memberNames: t.memberNames,
    projectTitle: t.projectTitle,
    technologies: t.technologies,
  }));
  return <TeamsManager initialTeams={rows} />;
}

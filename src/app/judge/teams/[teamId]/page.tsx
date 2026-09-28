import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAssignedTeam } from "@/lib/judges";

export const dynamic = "force-dynamic";

/**
 * Placeholder team page — exists to enforce assignment-scoped access.
 * The scoring form arrives in a later phase.
 */
export default async function JudgeTeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // The judge id comes from the session (layout already verified role + active).
  const { teamId } = await params;
  const team = await getAssignedTeam(prisma, session.user.id, teamId);
  if (!team) notFound();

  return (
    <div className="fade-in-up">
      <Link href="/judge" className="link text-sm">← Judge Dashboard</Link>
      <div className="mono mt-3 text-xs text-ink-3">{team.teamCode}</div>
      <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink">{team.name}</h1>
      {team.projectTitle && <p className="mt-1 text-sm text-ink-2">{team.projectTitle}</p>}
      <p className="mt-6 text-sm text-ink-3">Scoring will be available here soon.</p>
    </div>
  );
}

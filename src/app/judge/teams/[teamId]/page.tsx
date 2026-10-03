import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JudgeServiceError, isJudgingFinalized } from "@/lib/judges";
import { getOrStartEvaluation, requireAssignedTeam } from "@/lib/judgeEvaluations";
import { JudgeScoreForm } from "@/components/JudgeScoreForm";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** Opening an assigned team starts (or resumes) this judge's evaluation of it. */
export default async function JudgeTeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // The judge id comes from the session (layout already verified role + active).
  const judgeId = session.user.id;
  const { teamId } = await params;

  const team = await requireAssignedTeam(prisma, judgeId, teamId).catch((e) => {
    if (e instanceof JudgeServiceError && e.status === 404) notFound();
    throw e;
  });

  let evaluation: Awaited<ReturnType<typeof getOrStartEvaluation>> | null = null;
  let setupError: string | null = null;
  try {
    evaluation = await getOrStartEvaluation(prisma, judgeId, teamId);
  } catch (e) {
    if (!(e instanceof JudgeServiceError)) throw e;
    setupError = e.message; // e.g. rubric has no criteria
  }

  return (
    <div className="fade-in-up">
      <Link href="/judge" className="link text-sm">← My Assigned Teams</Link>

      <header className="mt-3 border-b border-[var(--glass-border)] pb-5">
        <div className="mono text-sm font-semibold text-ink-3">{team.teamCode}</div>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink">{team.projectTitle ?? "Untitled project"}</h1>
        {team.projectDescription && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{team.projectDescription}</p>}
        {team.repoUrl && (
          <a href={team.repoUrl} target="_blank" rel="noreferrer" className="mono mt-2 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
            {team.repoUrl.replace(/^https?:\/\/(www\.)?/, "")}<Icon.external size={11} />
          </a>
        )}
      </header>

      {setupError || !evaluation ? (
        <p className="mt-6 rounded-lg border border-warn/40 bg-surface px-4 py-3 text-sm" style={{ color: "var(--warn)" }}>
          {setupError ?? "This evaluation could not be loaded."}
        </p>
      ) : (
        <JudgeScoreForm
          evaluation={{ ...evaluation, submittedAt: evaluation.submittedAt?.toISOString() ?? null }}
          locked={await isJudgingFinalized(prisma)}
        />
      )}
    </div>
  );
}

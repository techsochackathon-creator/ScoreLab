import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isJudgingFinalized } from "@/lib/judges";
import { listTeamsWithStatus, summarizeProgress, type EvaluationStatus } from "@/lib/judgeEvaluations";
import { EmptyState } from "@/components/ui/misc";
import { ProgressBar } from "@/components/ui/ProgressBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judge Dashboard — ScoreLab" };

const STATUS: Record<EvaluationStatus, { label: string; pill: string; action: string }> = {
  NOT_STARTED: { label: "NOT STARTED", pill: "status-queued", action: "Start" },
  DRAFT: { label: "DRAFT", pill: "status-review", action: "Continue" },
  SUBMITTED: { label: "SUBMITTED", pill: "status-completed", action: "View" },
};

export default async function JudgeDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // Judge id comes from the session; the layout already verified role + active.
  // Only this judge's assigned teams and own evaluation statuses are loaded.
  const [teams, finalized] = await Promise.all([listTeamsWithStatus(prisma, session.user.id), isJudgingFinalized(prisma)]);
  const p = summarizeProgress(teams.map((t) => t.status));
  // Next action: finish a draft first, then start a new one.
  const next = finalized ? null : teams.find((t) => t.status === "DRAFT") ?? teams.find((t) => t.status === "NOT_STARTED") ?? null;

  return (
    <div className="fade-in-up">
      <header className="mb-5">
        <h1 className="page-title">My Assigned Teams</h1>
        <p className="page-sub">
          {p.assigned === 0
            ? "You have no teams assigned yet."
            : p.submitted === p.assigned
              ? "All your evaluations are submitted. Thank you!"
              : `${p.assigned - p.submitted} evaluation${p.assigned - p.submitted === 1 ? "" : "s"} still to submit.`}
        </p>
      </header>

      {finalized && (
        <p className="mb-4 notice notice-warn">
          Judging has been finalized. Evaluations can be viewed but no longer changed.
        </p>
      )}

      {p.assigned === 0 ? (
        <EmptyState icon="teams" title="You have no teams assigned yet." description="The organizer assigns teams to judges. Refresh this page once they have." />
      ) : (
        <>
          {next && (
            <section className="card mb-3 flex flex-wrap items-center gap-x-4 gap-y-3 p-4" style={{ borderLeft: "3px solid var(--brand)" }} aria-label="Next evaluation">
              <div className="min-w-0 flex-1 basis-56">
                <div className="section-title">Next up</div>
                <div className="mt-1 text-base font-semibold text-ink">
                  <span className="mono">{next.teamCode}</span>
                  {next.projectTitle && <span className="font-normal text-ink-2"> · {next.projectTitle}</span>}
                </div>
                <div className="mt-0.5 text-xs text-ink-3">{next.status === "DRAFT" ? "You have a draft in progress." : "Not started yet."}</div>
              </div>
              <Link href={`/judge/teams/${next.teamId}`} className="btn-primary w-full sm:w-auto">
                {next.status === "DRAFT" ? "Continue evaluation" : "Start evaluation"}
              </Link>
            </section>
          )}

          <section className="card mb-3 p-4" aria-label="Your progress">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {([["Assigned", p.assigned], ["Submitted", p.submitted], ["Drafts", p.draft], ["Not started", p.notStarted]] as const).map(([label, value]) => (
                <div key={label}>
                  <dd className="nums text-xl font-semibold leading-none text-ink">{value}</dd>
                  <dt className="mt-1 text-xs text-ink-3">{label}</dt>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-hair pt-3">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-ink-2">Progress</span>
                <span className="nums font-semibold text-ink">
                  {p.percent}% <span className="font-normal text-ink-3">({p.submitted} of {p.assigned} submitted)</span>
                </span>
              </div>
              <ProgressBar value={p.percent} color="var(--brand)" height={6} label="Your evaluations submitted" />
            </div>
          </section>

          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[0.8fr_2fr_0.9fr_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
              <span>Team Code</span><span>Project</span><span>Status</span><span className="w-24" />
            </div>
            <div className="divide-y divide-[var(--glass-border)]">
              {teams.map((t) => {
                const s = STATUS[t.status];
                const action = finalized && t.status !== "SUBMITTED" ? "View" : s.action;
                return (
                  <div key={t.teamId} className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[0.8fr_2fr_0.9fr_auto] sm:items-center sm:gap-4 sm:py-2.5">
                    <span className="mono text-sm font-semibold text-ink">{t.teamCode}</span>
                    <span className="min-w-0 truncate text-sm text-ink-2">{t.projectTitle ?? <span className="text-ink-3">—</span>}</span>
                    <span>
                      <span className={`status-pill ${s.pill}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                        {s.label}
                      </span>
                    </span>
                    <Link
                      href={`/judge/teams/${t.teamId}`}
                      className={`${action === "View" || t.teamId !== next?.teamId ? "btn-ghost" : "btn-primary"} w-full justify-center sm:w-24`}
                      aria-label={`${action} evaluation for ${t.teamCode}`}
                    >
                      {action}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

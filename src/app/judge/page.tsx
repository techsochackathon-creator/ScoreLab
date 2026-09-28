import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listTeamsWithStatus, type EvaluationStatus } from "@/lib/judgeEvaluations";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judge Dashboard — ScoreLab" };

const STATUS: Record<EvaluationStatus, { label: string; pill: string; action: string }> = {
  NOT_STARTED: { label: "Not Started", pill: "status-queued", action: "Start" },
  DRAFT: { label: "Draft", pill: "status-review", action: "Continue" },
  SUBMITTED: { label: "Submitted", pill: "status-completed", action: "View" },
};

export default async function JudgeDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // Judge id comes from the session; the layout already verified role + active.
  const teams = await listTeamsWithStatus(prisma, session.user.id);
  const submitted = teams.filter((t) => t.status === "SUBMITTED").length;

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">My Assigned Teams</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          {teams.length === 0
            ? "No teams have been assigned to you yet."
            : `${submitted} of ${teams.length} evaluation${teams.length === 1 ? "" : "s"} submitted.`}
        </p>
      </header>

      {teams.length === 0 ? (
        <EmptyState icon="teams" title="Nothing to judge yet" description="The organizer will assign teams to you. Check back soon." />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[0.8fr_2fr_0.8fr_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
            <span>Team Code</span><span>Project</span><span>Status</span><span className="w-24" />
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            {teams.map((t) => {
              const s = STATUS[t.status];
              return (
                <div key={t.teamId} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[0.8fr_2fr_0.8fr_auto] sm:items-center sm:gap-4">
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
                    className={`${t.status === "SUBMITTED" ? "btn-ghost" : "btn-primary"} w-24 justify-center`}
                  >
                    {s.action}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

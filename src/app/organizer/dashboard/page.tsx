import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDataset, summary } from "@/lib/stats";
import { StatCard, EmptyState, SectionTitle, StatusBadge } from "@/components/ui/misc";
import { totalBandVar } from "@/components/ui/ProgressBar";
import { Icon, type IconName } from "@/components/ui/icons";
import { JudgingStatusCard } from "@/components/JudgingStatusCard";
import { getJudgeResults } from "@/lib/judgeResults";
import { finalizationBlockers, getOfficialState, judgingProgress } from "@/lib/officialResults";

export const dynamic = "force-dynamic";

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function OverviewPage() {
  const ds = await getDataset();
  // Official (judge-score) workflow status — shown first.
  const official = await getOfficialState(prisma);
  const live = official ? null : await getJudgeResults(prisma);
  const totals = ds.teams.map((t) => t.totalScore);
  const s = summary(totals);

  // Recent evaluated submissions for the table
  const recentSubs = await prisma.submission.findMany({
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: { team: { select: { name: true } } },
  });

  return (
    <div className="fade-in-up">
      {/* ── Header ── */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Judging status first, then the AI reference evaluation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/organizer/results" className="btn-ghost">Official results</Link>
          <Link href="/organizer/evaluations" className="btn-ghost">
            <Icon.spark size={16} /> AI evaluation
          </Link>
        </div>
      </header>

      {/* ── Official judging status ── */}
      {official ? (
        <JudgingStatusCard phase="FINALIZED" state={official} />
      ) : (
        <JudgingStatusCard phase="JUDGING_OPEN" progress={judgingProgress(live!)} blockers={finalizationBlockers(live!).length} />
      )}

      {/* ── AI evaluation (reference) ── */}
      <div className="mb-3 mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="section-title">AI evaluation</h2>
        <span className="text-xs text-ink-3">Reference only — not used for official results</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Teams" value={ds.teamsTotal} icon="teams" />
        <StatCard label="Evaluated" value={ds.teams.length} icon="check" accent foot={ds.teamsTotal ? `of ${ds.teamsTotal} teams` : undefined} />
        <StatCard label="Avg Score" value={s.count ? s.avg.toFixed(1) : "—"} icon="analytics" foot={s.count ? `across ${s.count} teams` : "no data yet"} />
        <StatCard label="Top Score" value={s.count ? s.max.toFixed(1) : "—"} icon="leaderboard" />
      </div>

      {/* ── Recent Evaluations Table ── */}
      {recentSubs.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <div className="flex items-center justify-between border-b border-hair px-4 py-3">
            <h2 className="section-title">Recent Evaluations</h2>
            <Link href="/organizer/evaluations" className="link-brand text-xs">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hair text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                  <th scope="col" className="px-4 py-2.5">Team</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Score</th>
                  <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Completed</th>
                  <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {recentSubs.map((sub) => (
                  <tr key={sub.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{sub.team.name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={sub.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {sub.finalScore != null ? (
                        <span className="nums font-semibold" style={{ color: totalBandVar(sub.finalScore) }}>
                          {sub.finalScore.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs text-ink-3 sm:table-cell">
                      {sub.evaluatedAt ? timeAgo(sub.evaluatedAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/organizer/submissions/${sub.id}`} className="link-brand text-xs" aria-label={`View evaluation for ${sub.team.name}`}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="mt-6">
        <SectionTitle>Quick Actions</SectionTitle>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction href="/organizer/evaluations" icon="spark" label="Start Evaluation" primary />
          <QuickAction href="/organizer/teams" icon="teams" label="Manage Teams" />
          <QuickAction href="/organizer/rubric" icon="rubric" label="Edit Rubric" />
          <QuickAction href="/organizer/analytics" icon="analytics" label="View Analytics" />
        </div>
      </div>

      {/* ── Empty state (only when truly empty) ── */}
      {ds.teams.length === 0 && ds.teamsTotal === 0 && (
        <div className="mt-6">
          <EmptyState
            icon="teams"
            title="No teams yet"
            description="Add teams, then evaluate their repositories to see results here."
            action={<Link href="/organizer/teams" className="btn-primary">Add teams</Link>}
          />
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function QuickAction({ href, icon, label, primary }: { href: string; icon: IconName; label: string; primary?: boolean }) {
  const I = Icon[icon];
  return (
    <Link href={href} className="card-interactive flex items-center gap-3 px-3 py-2.5">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
        style={{
          background: primary ? "var(--brand-tint)" : "var(--surface-2)",
          color: primary ? "var(--brand-text)" : "var(--ink-3)",
        }}
      >
        <I size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{label}</span>
      <Icon.chevronRight size={14} className="shrink-0 text-ink-3" />
    </Link>
  );
}

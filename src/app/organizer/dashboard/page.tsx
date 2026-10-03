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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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
    <div className="ambient-glow">
      {/* ── Hero Section ── */}
      <div className="relative z-10 mb-8 fade-in-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-ink-3">
              <span style={{ color: "var(--brand)" }}>✦</span>
              Hackathon Evaluation Platform
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">
              {getGreeting()}, Organizer <span className="inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_infinite]">✨</span>
            </h1>
            <p className="mt-1.5 text-sm text-ink-3">
              Here&apos;s what&apos;s happening with your hackathon today.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/organizer/results" className="btn-primary">Official results</Link>
            <Link href="/organizer/evaluations" className="btn-ghost">
              <Icon.spark size={16} /> AI evaluation
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-10 fade-in-up">
        {official ? (
          <JudgingStatusCard phase="FINALIZED" state={official} />
        ) : (
          <JudgingStatusCard phase="JUDGING_OPEN" progress={judgingProgress(live!)} blockers={finalizationBlockers(live!).length} />
        )}
      </div>

      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wider text-ink-3">AI evaluation (reference only — not used for official results)</h2>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="fade-in-up delay-1">
          <StatCard label="Total Teams" value={ds.teamsTotal} icon="teams" />
        </div>
        <div className="fade-in-up delay-2">
          <StatCard label="Evaluated" value={ds.teams.length} icon="check" accent />
        </div>
        <div className="fade-in-up delay-3">
          <StatCard label="Avg Score" value={s.count ? s.avg.toFixed(1) : "—"} icon="analytics" foot={s.count ? `across ${s.count} teams` : "no data yet"} />
        </div>
        <div className="fade-in-up delay-4">
          <StatCard label="Top Score" value={s.count ? s.max.toFixed(1) : "—"} icon="leaderboard" />
        </div>
      </div>

      {/* ── Recent Evaluations Table ── */}
      {recentSubs.length > 0 && (
        <div className="mt-4 card overflow-hidden fade-in-up delay-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3">Recent Evaluations</h2>
            <Link href="/organizer/evaluations" className="link-brand text-xs">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--glass-border)] text-left text-xs font-medium text-ink-3 uppercase tracking-wider">
                  <th className="px-5 py-3">Team</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Score</th>
                  <th className="px-5 py-3 text-right hidden sm:table-cell">Completed</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)]">
                {recentSubs.map((sub) => (
                  <tr key={sub.id} className="transition-colors hover:bg-[var(--surface-2)]">
                    <td className="px-5 py-3">
                      <span className="font-medium text-ink">{sub.team.name}</span>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={sub.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {sub.finalScore != null ? (
                        <span className="nums font-semibold" style={{ color: totalBandVar(sub.finalScore) }}>
                          {sub.finalScore.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-ink-3 hidden sm:table-cell">
                      {sub.evaluatedAt ? timeAgo(sub.evaluatedAt) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/organizer/submissions/${sub.id}`} className="link-brand text-xs">View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="mt-4 fade-in-up delay-8">
        <SectionTitle>Quick Actions</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {/* Wave animation keyframe */}
      <style>{`@keyframes wave{0%,100%{transform:rotate(0deg)}25%{transform:rotate(20deg)}75%{transform:rotate(-10deg)}}`}</style>
    </div>
  );
}

/* ── Sub-components ── */

function QuickAction({ href, icon, label, primary }: { href: string; icon: IconName; label: string; primary?: boolean }) {
  const I = Icon[icon];
  return (
    <Link
      href={href}
      className="card-interactive flex flex-col items-center gap-2.5 px-4 py-5 text-center"
      style={primary ? { borderColor: "rgba(147, 133, 255, 0.22)", boxShadow: "var(--glow-brand-sm)" } : undefined}
    >
      <span
        className="grid h-10 w-10 place-items-center rounded-xl"
        style={{
          background: primary ? "var(--brand-tint)" : "var(--surface-2)",
          color: primary ? "var(--brand)" : "var(--ink-3)",
        }}
      >
        <I size={20} />
      </span>
      <span className={`text-sm font-medium ${primary ? "text-ink" : "text-ink-2"}`}>{label}</span>
    </Link>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDataset, summary } from "@/lib/stats";
import { StatCard, EmptyState, SectionTitle, StatusBadge } from "@/components/ui/misc";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { ProgressBar, totalBandVar } from "@/components/ui/ProgressBar";
import { Icon, type IconName } from "@/components/ui/icons";

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

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  EVALUATED: { icon: "✓", color: "var(--good)" },
  EVALUATING: { icon: "▶", color: "var(--info)" },
  REVIEW_REQUIRED: { icon: "⚠", color: "var(--warn)" },
  FAILED: { icon: "✕", color: "var(--bad)" },
};

export default async function OverviewPage() {
  const ds = await getDataset();
  const totals = ds.teams.map((t) => t.totalScore);
  const s = summary(totals);
  const completion = ds.teamsTotal ? Math.round((ds.teams.length / ds.teamsTotal) * 100) : 0;
  const topTeams = [...ds.teams].sort((a, b) => b.totalScore - a.totalScore).slice(0, 3);

  const events = await prisma.evaluationEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { team: true },
  });

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
          <div className="flex gap-2">
            <Link href="/organizer/evaluations" className="btn-primary">
              <Icon.spark size={16} /> Start evaluation
            </Link>
          </div>
        </div>
      </div>

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
          <StatCard label="Top Score" value={s.count ? s.max.toFixed(1) : "—"} icon="leaderboard" foot={topTeams[0] ? topTeams[0].teamName : undefined} />
        </div>
      </div>

      {/* ── Progress + Activity row ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Evaluation Progress Panel */}
        <div className="card p-6 lg:col-span-1 fade-in-up delay-5">
          <SectionTitle>Evaluation Progress</SectionTitle>
          <div className="flex items-center gap-5">
            <ScoreRing value={completion} max={100} label="complete" decimals={0} color="var(--brand)" />
            <div className="flex-1 space-y-2.5">
              <ProgressItem label="Completed" value={ds.statusCounts.evaluated} color="var(--good)" />
              {ds.statusCounts.evaluating > 0 && (
                <ProgressItem label="Running" value={ds.statusCounts.evaluating} color="var(--info)" pulse />
              )}
              {ds.statusCounts.other > 0 && (
                <ProgressItem label="Queued" value={ds.statusCounts.other} color="var(--ink-3)" />
              )}
              {ds.statusCounts.failed > 0 && (
                <ProgressItem label="Failed" value={ds.statusCounts.failed} color="var(--bad)" />
              )}
            </div>
          </div>
        </div>

        {/* Recent Activity Timeline */}
        <div className="card p-6 lg:col-span-2 fade-in-up delay-6">
          <SectionTitle right={<Link href="/organizer/evaluations" className="link-brand text-xs">View all →</Link>}>
            Recent Activity
          </SectionTitle>
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">No evaluations yet.</p>
          ) : (
            <ul className="flex flex-col">
              {events.slice(0, 8).map((e, i) => {
                const ev = EVENT_ICONS[e.status ?? "EVALUATED"] ?? EVENT_ICONS.EVALUATED;
                return (
                  <li key={e.id} className="flex items-center gap-3 border-b border-[var(--glass-border)] py-2.5 last:border-0">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold"
                      style={{ background: `${ev.color}15`, color: ev.color }}
                    >
                      {ev.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-sm text-ink">{e.team.name}</span>
                      {e.status && e.status !== "EVALUATED" && (
                        <span className="ml-2 text-[11px] text-ink-3">
                          {e.status === "REVIEW_REQUIRED" ? "Review required" : e.status.toLowerCase()}
                        </span>
                      )}
                    </div>
                    {e.totalScore != null && (
                      <span className="nums text-sm font-semibold" style={{ color: totalBandVar(e.totalScore) }}>
                        {e.totalScore.toFixed(1)}
                      </span>
                    )}
                    <span className="w-16 shrink-0 text-right text-[11px] text-ink-3">{timeAgo(e.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Top Teams + AI Card row ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top Performing Teams */}
        <div className="card p-6 lg:col-span-2 fade-in-up delay-7">
          <SectionTitle right={<Link href="/leaderboard" className="link-brand text-xs">View leaderboard →</Link>}>
            Top Performing Teams
          </SectionTitle>
          {topTeams.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-3">No evaluated teams yet.</p>
          ) : (
            <div className="space-y-3">
              {topTeams.map((t, i) => {
                const medals = ["var(--gold)", "var(--silver)", "var(--bronze)"];
                return (
                  <div
                    key={t.teamId}
                    className="flex items-center gap-4 rounded-lg p-3 transition-all hover:bg-[var(--surface-2)]"
                    style={{ border: i === 0 ? "1px solid rgba(251, 191, 36, 0.15)" : "1px solid transparent" }}
                  >
                    <span
                      className="mono grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                      style={{ background: medals[i] ?? "var(--ink-3)", boxShadow: i === 0 ? "0 0 12px rgba(251, 191, 36, 0.2)" : "none" }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{t.teamName}</div>
                      <div className="text-[11px] text-ink-3">{t.university}</div>
                    </div>
                    <div className="text-right">
                      <span className="nums text-lg font-bold" style={{ color: totalBandVar(t.totalScore) }}>
                        {t.totalScore.toFixed(1)}
                      </span>
                      <span className="ml-0.5 text-xs text-ink-3">/100</span>
                    </div>
                    <ProgressBar value={t.totalScore} color={totalBandVar(t.totalScore)} className="hidden w-20 sm:block" height={4} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Powered by AI Card */}
        <div className="card p-6 lg:col-span-1 fade-in-up delay-8">
          <div className="flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg"
              style={{ background: "var(--brand-tint)" }}
            >
              <Icon.spark size={16} style={{ color: "var(--brand)" }} />
            </span>
            <SectionTitle>Powered by Gemini AI</SectionTitle>
          </div>
          <ul className="mt-3 space-y-3">
            {[
              "Analyzes project evidence from repositories",
              "Evaluates against your rubric criteria",
              "Provides detailed reasoning per criterion",
              "Enables consistent, auditable evaluation",
            ].map((text) => (
              <li key={text} className="flex items-start gap-2 text-sm text-ink-2">
                <span className="mt-0.5" style={{ color: "var(--brand)" }}>✓</span>
                {text}
              </li>
            ))}
          </ul>
          <div className="section-divider mt-4" />
          <p className="mt-3 text-[11px] text-ink-3 leading-relaxed">
            AI-assisted evidence analysis. Final weighted scores are calculated server-side for deterministic results.
          </p>
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

function ProgressItem({ label, value, color, pulse }: { label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${pulse ? "pulse-glow" : ""}`} style={{ background: color }} />
        <span className="text-xs text-ink-2">{label}</span>
      </div>
      <span className="nums text-xs font-semibold text-ink">{value}</span>
    </div>
  );
}

function QuickAction({ href, icon, label, primary }: { href: string; icon: IconName; label: string; primary?: boolean }) {
  const I = Icon[icon];
  return (
    <Link
      href={href}
      className="card-interactive flex flex-col items-center gap-2.5 px-4 py-5 text-center"
      style={primary ? { borderColor: "rgba(16, 185, 129, 0.15)", boxShadow: "var(--glow-brand-sm)" } : undefined}
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

"use client";

import { useState } from "react";
import { Histogram, BarList, RadarChart } from "@/components/charts/Charts";
import { StatCard, EmptyState, SectionTitle } from "@/components/ui/misc";

export interface AnalyticsData {
  summary: { count: number; avg: number; max: number; min: number; sd: number };
  hist: { bins: number[]; labels: string[] };
  perCriterion: { label: string; pct: number }[];
  progress: { evaluated: number; total: number; failed: number; evaluating: number };
  criteria: { name: string; scaleMax: number }[];
  teams: { teamId: string; teamName: string; values: number[] }[];
}

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const [teamId, setTeamId] = useState(data.teams[0]?.teamId ?? "");
  const team = data.teams.find((t) => t.teamId === teamId);
  const axes = data.criteria.map((c) => c.name);
  const scaleMax = data.criteria[0]?.scaleMax ?? 5;

  if (data.summary.count === 0) {
    return (
      <div className="fade-in-up">
        <Header />
        <EmptyState icon="analytics" title="No analytics yet" description="Analytics populate once teams have been evaluated." />
      </div>
    );
  }

  const pctDone = data.progress.total ? Math.round((data.progress.evaluated / data.progress.total) * 100) : 0;

  return (
    <div className="fade-in-up">
      <Header />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Average" value={data.summary.avg.toFixed(1)} icon="analytics" accent />
        <StatCard label="Highest" value={data.summary.max.toFixed(1)} icon="leaderboard" />
        <StatCard label="Lowest" value={data.summary.min.toFixed(1)} icon="trendDown" />
        <StatCard label="Spread (σ)" value={data.summary.sd.toFixed(1)} icon="spark" foot="score consistency" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle>Score distribution</SectionTitle>
          <Histogram bins={data.hist.bins} labels={data.hist.labels} />
          <p className="mt-2 text-xs text-ink-3">Teams grouped into 10-point bands (0–100).</p>
        </div>
        <div className="card p-5">
          <SectionTitle>Criterion performance</SectionTitle>
          <BarList items={data.perCriterion.map((c) => ({ label: c.label, value: c.pct }))} unit="%" />
          <p className="mt-2 text-xs text-ink-3">Average score per criterion, normalized to 100%.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Team profile</h2>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="field w-auto py-1.5 text-xs">
              {data.teams.map((t) => (<option key={t.teamId} value={t.teamId}>{t.teamName}</option>))}
            </select>
          </div>
          {team && axes.length >= 3 ? (
            <RadarChart axes={axes} values={team.values} max={scaleMax} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-3">A radar needs at least three criteria.</p>
          )}
        </div>
        <div className="card p-5">
          <SectionTitle>Evaluation progress</SectionTitle>
          <div className="flex items-center gap-2">
            <span className="stat-value">{pctDone}</span><span className="text-lg font-bold text-ink-3">%</span>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Legend color="var(--good)" label="Completed" value={data.progress.evaluated} />
            <Legend color="var(--info)" label="In progress" value={data.progress.evaluating} />
            <Legend color="var(--bad)" label="Failed" value={data.progress.failed} />
            <Legend color="var(--ink-3)" label="Total teams" value={data.progress.total} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Analytics</h1>
      <p className="mt-1 text-sm text-ink-2">Score distribution, criterion performance, and team profiles.</p>
    </header>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="nums font-semibold text-ink">{value}</span>
    </div>
  );
}

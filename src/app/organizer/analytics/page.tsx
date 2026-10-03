import { getDataset, summary, histogram, perCriterion } from "@/lib/stats";
import { AnalyticsView, type AnalyticsData } from "@/components/AnalyticsView";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const ds = await getDataset();
  const totals = ds.teams.map((t) => t.totalScore);
  const s = summary(totals);
  const pc = perCriterion(ds);

  const data: AnalyticsData = {
    summary: { count: s.count, avg: s.avg, max: s.max, min: s.min, sd: s.sd },
    hist: histogram(totals),
    perCriterion: pc.map((c) => ({ label: c.label, pct: c.pct })),
    progress: {
      evaluated: ds.teams.length,
      total: ds.teamsTotal,
      failed: ds.statusCounts.failed,
      evaluating: ds.statusCounts.evaluating,
    },
    criteria: ds.criteria.map((c) => ({ name: c.name, scaleMax: c.scaleMax })),
    teams: ds.teams.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      values: ds.criteria.map((c) => t.scores[c.id] ?? 0),
    })),
  };

  return <AnalyticsView data={data} />;
}

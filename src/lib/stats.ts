import { prisma } from "@/lib/prisma";
import { getOrCreateRubric } from "@/lib/rubric";

export interface DatasetCriterion {
  id: string;
  name: string;
  weight: number;
  scaleMax: number;
}
export interface DatasetTeam {
  teamId: string;
  teamName: string;
  university: string;
  track: string;
  submissionId: string;
  totalScore: number;
  scores: Record<string, number>; // criterionId -> raw score
}
export interface Dataset {
  criteria: DatasetCriterion[];
  teamsTotal: number;
  teams: DatasetTeam[]; // latest evaluated submission per team
  statusCounts: { evaluated: number; failed: number; evaluating: number; other: number };
}

/** Everything the analytics/integrity/overview pages compute from. All real. */
export async function getDataset(): Promise<Dataset> {
  const rubric = await getOrCreateRubric();
  const criteria: DatasetCriterion[] = rubric.criteria.map((c) => ({
    id: c.id,
    name: c.name,
    weight: c.weight,
    scaleMax: c.scaleMax,
  }));

  const teamsTotal = await prisma.team.count();

  const subs = await prisma.submission.findMany({
    where: { status: "EVALUATED", totalScore: { not: null } },
    orderBy: { evaluatedAt: "desc" },
    include: { team: true, scores: true },
  });

  const seen = new Set<string>();
  const teams: DatasetTeam[] = [];
  for (const s of subs) {
    if (seen.has(s.teamId)) continue;
    seen.add(s.teamId);
    const scores: Record<string, number> = {};
    for (const sc of s.scores) scores[sc.criterionId] = sc.score;
    teams.push({
      teamId: s.teamId,
      teamName: s.team.name,
      university: s.team.university,
      track: s.team.track,
      submissionId: s.id,
      totalScore: s.totalScore ?? 0,
      scores,
    });
  }

  const allStatuses = await prisma.submission.groupBy({ by: ["status"], _count: true });
  const sc = { evaluated: 0, failed: 0, evaluating: 0, other: 0 };
  for (const row of allStatuses) {
    if (row.status === "EVALUATED") sc.evaluated += row._count;
    else if (row.status === "FAILED") sc.failed += row._count;
    else if (row.status === "EVALUATING") sc.evaluating += row._count;
    else sc.other += row._count;
  }

  return { criteria, teamsTotal, teams, statusCounts: sc };
}

// --- pure helpers -----------------------------------------------------------

export function summary(totals: number[]) {
  const n = totals.length;
  if (n === 0) return { count: 0, avg: 0, max: 0, min: 0, sd: 0, median: 0 };
  const sorted = [...totals].sort((a, b) => a - b);
  const avg = totals.reduce((s, v) => s + v, 0) / n;
  const variance = totals.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { count: n, avg, max: sorted[n - 1], min: sorted[0], sd: Math.sqrt(variance), median };
}

/** 10 bins of width 10 across 0–100. */
export function histogram(totals: number[]) {
  const bins = new Array(10).fill(0);
  for (const t of totals) {
    const idx = Math.min(9, Math.max(0, Math.floor(t / 10)));
    bins[idx]++;
  }
  const labels = bins.map((_, i) => `${i * 10}`);
  return { bins, labels };
}

/** Per-criterion average, normalized to 0–100 (score/scaleMax) and raw. */
export function perCriterion(ds: Dataset) {
  return ds.criteria.map((c) => {
    const vals = ds.teams.map((t) => t.scores[c.id]).filter((v) => v != null) as number[];
    const rawAvg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { id: c.id, label: c.name, scaleMax: c.scaleMax, rawAvg, pct: (rawAvg / c.scaleMax) * 100 };
  });
}

/** Outlier teams by IQR rule on total score. Neutral: "variance", not "bias". */
export function outliers(ds: Dataset) {
  const totals = ds.teams.map((t) => t.totalScore).sort((a, b) => a - b);
  const n = totals.length;
  if (n < 4) return { list: [], lowFence: 0, highFence: 100, q1: 0, q3: 0 };
  const q = (p: number) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return totals[lo] + (totals[hi] - totals[lo]) * (idx - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const { median } = summary(ds.teams.map((t) => t.totalScore));
  const list = ds.teams
    .filter((t) => t.totalScore < lowFence || t.totalScore > highFence)
    .map((t) => ({ ...t, delta: t.totalScore - median }));
  return { list, lowFence, highFence, q1, q3 };
}

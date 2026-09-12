import { prisma } from "@/lib/prisma";

/**
 * Integrity metrics pulled from real EvaluationEvent, Submission, and BatchRun
 * records. Every number on the integrity page comes from this module — no
 * placeholders, no guesses.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineMetrics {
  /** Total evaluation runs (EvaluationEvent rows). */
  totalRuns: number;
  /** Runs that reached EVALUATED status. */
  evaluated: number;
  /** Runs that hit FAILED status. */
  failed: number;
  /** Runs flagged REVIEW_REQUIRED. */
  reviewRequired: number;
  /** Currently EVALUATING. */
  evaluating: number;
}

export interface FlagCounts {
  identityLeakage: number;
  insufficientEvidence: number;
  limitedEvidence: number;
  invalidAiOutput: number;
  invalidRubric: number;
  scoreCalculationError: number;
}

export interface ConfidenceStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  lowCount: number;     // confidence < 0.4
  mediumCount: number;  // 0.4 ≤ confidence < 0.7
  highCount: number;    // confidence ≥ 0.7
}

export interface VersionInfo {
  models: { model: string; count: number }[];
  promptVersions: { version: string; count: number }[];
  rubricVersions: { version: string; count: number }[];
}

export interface BatchSummary {
  totalBatches: number;
  completed: number;
  running: number;
  paused: number;
  cancelled: number;
  totalJobsRun: number;
  latestBatch: {
    id: string;
    status: string;
    totalJobs: number;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
}

export interface ScoreDistribution {
  /** 10 bins [0–10), [10–20), …, [90–100]. */
  bins: number[];
  labels: string[];
  count: number;
  avg: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  lowFence: number;
  highFence: number;
}

export interface IntegrityData {
  pipeline: PipelineMetrics;
  flags: FlagCounts;
  confidence: ConfidenceStats;
  versions: VersionInfo;
  batch: BatchSummary;
  distribution: ScoreDistribution;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function getPipelineMetrics(): Promise<PipelineMetrics> {
  const groups = await prisma.evaluationEvent.groupBy({
    by: ["status"],
    _count: true,
  });
  const c = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  return {
    totalRuns: groups.reduce((sum, g) => sum + g._count, 0),
    evaluated: c("EVALUATED"),
    failed: c("FAILED"),
    reviewRequired: c("REVIEW_REQUIRED"),
    evaluating: c("EVALUATING"),
  };
}

async function getFlagCounts(): Promise<FlagCounts> {
  // Prisma doesn't support groupBy on array fields, so count per flag.
  const [identity, insufficient, limited, invalidAi, invalidRubric, scoreCalc] =
    await Promise.all([
      prisma.evaluationEvent.count({ where: { flags: { has: "IDENTITY_LEAKAGE" } } }),
      prisma.evaluationEvent.count({ where: { flags: { has: "INSUFFICIENT_EVIDENCE" } } }),
      prisma.evaluationEvent.count({ where: { flags: { has: "LIMITED_EVIDENCE" } } }),
      prisma.evaluationEvent.count({ where: { flags: { has: "INVALID_AI_OUTPUT" } } }),
      prisma.evaluationEvent.count({ where: { flags: { has: "INVALID_RUBRIC" } } }),
      prisma.evaluationEvent.count({ where: { flags: { has: "SCORE_CALCULATION_ERROR" } } }),
    ]);
  return {
    identityLeakage: identity,
    insufficientEvidence: insufficient,
    limitedEvidence: limited,
    invalidAiOutput: invalidAi,
    invalidRubric: invalidRubric,
    scoreCalculationError: scoreCalc,
  };
}

async function getConfidenceStats(): Promise<ConfidenceStats> {
  const events = await prisma.evaluationEvent.findMany({
    where: { confidence: { not: null } },
    select: { confidence: true },
  });
  const vals = events.map((e) => e.confidence!);
  const count = vals.length;
  if (count === 0) return { count: 0, avg: 0, min: 0, max: 0, lowCount: 0, mediumCount: 0, highCount: 0 };

  const sorted = [...vals].sort((a, b) => a - b);
  const avg = vals.reduce((s, v) => s + v, 0) / count;
  return {
    count,
    avg: Math.round(avg * 100) / 100,
    min: sorted[0],
    max: sorted[count - 1],
    lowCount: vals.filter((v) => v < 0.4).length,
    mediumCount: vals.filter((v) => v >= 0.4 && v < 0.7).length,
    highCount: vals.filter((v) => v >= 0.7).length,
  };
}

async function getVersionInfo(): Promise<VersionInfo> {
  // Model versions.
  const modelGroups = await prisma.evaluationEvent.groupBy({
    by: ["model"],
    where: { model: { not: null } },
    _count: true,
    orderBy: { _count: { model: "desc" } },
  });
  const models = modelGroups.map((g) => ({ model: g.model!, count: g._count }));

  // Prompt versions.
  const promptGroups = await prisma.evaluationEvent.groupBy({
    by: ["promptVersion"],
    where: { promptVersion: { not: null } },
    _count: true,
    orderBy: { _count: { promptVersion: "desc" } },
  });
  const promptVersions = promptGroups.map((g) => ({ version: g.promptVersion!, count: g._count }));

  // Rubric versions.
  const rubricGroups = await prisma.evaluationEvent.groupBy({
    by: ["rubricVersion"],
    where: { rubricVersion: { not: null } },
    _count: true,
    orderBy: { _count: { rubricVersion: "desc" } },
  });
  const rubricVersions = rubricGroups.map((g) => ({ version: g.rubricVersion!, count: g._count }));

  return { models, promptVersions, rubricVersions };
}

async function getBatchSummary(): Promise<BatchSummary> {
  const groups = await prisma.batchRun.groupBy({
    by: ["status"],
    _count: true,
  });
  const c = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;

  const totalJobsAgg = await prisma.batchRun.aggregate({ _sum: { totalJobs: true } });

  const latest = await prisma.batchRun.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, totalJobs: true, createdAt: true, completedAt: true },
  });

  return {
    totalBatches: groups.reduce((sum, g) => sum + g._count, 0),
    completed: c("COMPLETED"),
    running: c("RUNNING"),
    paused: c("PAUSED"),
    cancelled: c("CANCELLED"),
    totalJobsRun: totalJobsAgg._sum.totalJobs ?? 0,
    latestBatch: latest
      ? { id: latest.id, status: latest.status, totalJobs: latest.totalJobs, createdAt: latest.createdAt, completedAt: latest.completedAt }
      : null,
  };
}

function computeDistribution(scores: number[]): ScoreDistribution {
  const bins = new Array(10).fill(0);
  const labels = bins.map((_, i) => `${i * 10}`);
  const n = scores.length;

  if (n === 0)
    return { bins, labels, count: 0, avg: 0, median: 0, sd: 0, min: 0, max: 0, q1: 0, q3: 0, iqr: 0, lowFence: 0, highFence: 100 };

  const sorted = [...scores].sort((a, b) => a - b);
  for (const s of scores) bins[Math.min(9, Math.max(0, Math.floor(s / 10)))]++;

  const avg = scores.reduce((s, v) => s + v, 0) / n;
  const variance = scores.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

  const q = (p: number) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const q1 = n >= 4 ? q(0.25) : sorted[0];
  const q3 = n >= 4 ? q(0.75) : sorted[n - 1];
  const iqr = q3 - q1;

  return {
    bins,
    labels,
    count: n,
    avg: Math.round(avg * 10) / 10,
    median: Math.round(median * 10) / 10,
    sd: Math.round(Math.sqrt(variance) * 10) / 10,
    min: sorted[0],
    max: sorted[n - 1],
    q1: Math.round(q1 * 10) / 10,
    q3: Math.round(q3 * 10) / 10,
    iqr: Math.round(iqr * 10) / 10,
    lowFence: Math.round((q1 - 1.5 * iqr) * 10) / 10,
    highFence: Math.round((q3 + 1.5 * iqr) * 10) / 10,
  };
}

async function getScoreDistribution(): Promise<ScoreDistribution> {
  // Latest finalScore per team from evaluated submissions.
  const subs = await prisma.submission.findMany({
    where: { status: "EVALUATED", finalScore: { not: null } },
    orderBy: { evaluatedAt: "desc" },
    select: { teamId: true, finalScore: true },
  });
  const seen = new Set<string>();
  const scores: number[] = [];
  for (const s of subs) {
    if (seen.has(s.teamId)) continue;
    seen.add(s.teamId);
    scores.push(s.finalScore!);
  }
  return computeDistribution(scores);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function getIntegrityData(): Promise<IntegrityData> {
  const [pipeline, flags, confidence, versions, batch, distribution] = await Promise.all([
    getPipelineMetrics(),
    getFlagCounts(),
    getConfidenceStats(),
    getVersionInfo(),
    getBatchSummary(),
    getScoreDistribution(),
  ]);
  return { pipeline, flags, confidence, versions, batch, distribution };
}

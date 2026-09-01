import type { CheckType } from "@prisma/client";
import { maxPointsFor } from "@/lib/scoringRules";

/**
 * Pure aggregation service (no DB access).
 *
 * Scoring model
 * -------------
 * Every rubric criterion has a `weight` (a fraction; the rubric builder makes
 * all weights sum to 1.0) and a `scoringRules` config that defines a maximum
 * point value. The evaluation pipeline stores each criterion's earned points in
 * `CriterionResult.computedScore`.
 *
 * For each criterion we normalize:  norm_i = clamp(computedScore_i / maxPoints_i, 0, 1)
 * and its weighted contribution is  weight_i * norm_i.
 *
 *   automatedWeighted = Σ (weight_i * norm_i)   over automated criteria
 *   technicalScore    = 100 * automatedWeighted / automatedWeight
 *                       (automated weights rescaled to fill 100 — always
 *                        comparable, independent of whether a human score exists)
 *
 * Human score
 * -----------
 * `humanScore` lives on the Submission (organizer enters it later, else null).
 * Its weight is the rubric's `human_score` criterion weight. When a human score
 * is present:
 *
 *   humanNorm  = clamp(humanScore / maxScore, 0, 1)
 *   finalScore = 100 * (automatedWeighted + humanWeight * humanNorm)
 *                      / (automatedWeight + humanWeight)
 *
 * When absent, finalScore falls back to technicalScore (the human weight is
 * simply not applied). Unmeasured criteria (null computedScore — e.g. no
 * liveUrl) count as 0 while keeping their weight, so gaps cost points.
 */

const EPS = 1e-9;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface CriterionResultInput {
  criterionId: string;
  computedScore: number | null;
  rawMetric: number | null;
}

export interface CriterionInput {
  id: string;
  name: string;
  checkType: CheckType;
  weight: number;
  scoringRules: unknown;
}

export interface SubmissionInput {
  submissionId: string;
  teamId: string;
  teamName: string;
  university: string;
  humanScore: number | null;
  submittedAt: Date | string;
  /** null when the submission has no completed evaluation job. */
  jobId: string | null;
  jobStatus: string | null;
  results: CriterionResultInput[];
}

export interface CriterionContribution {
  criterionId: string;
  name: string;
  checkType: CheckType;
  weight: number;
  rawMetric: number | null;
  computedScore: number | null;
  maxPoints: number;
  /** 0..1 */
  normalized: number;
  /** weight * normalized (0..weight) */
  weightedContribution: number;
  measured: boolean;
}

export interface SubmissionScore {
  submissionId: string;
  teamId: string;
  teamName: string;
  university: string;
  evaluated: boolean;
  jobId: string | null;
  jobStatus: string | null;
  submittedAt: string;

  contributions: CriterionContribution[];
  automatedWeight: number;
  humanWeight: number;

  /** 0..100, automated criteria rescaled to fill 100. Null if no automated weight. */
  technicalScore: number | null;

  humanScore: number | null;
  humanMaxScore: number | null;
  humanNormalized: number | null;
  humanScored: boolean;

  /** 0..100. Blends human score by its weight when present, else = technicalScore. */
  finalScore: number | null;

  /** Normalized (0..1) value per checkType, for tie-breaks. */
  normByCheck: Partial<Record<CheckType, number>>;
}

/** Compute the full score breakdown for one submission. */
export function computeSubmissionScore(
  submission: SubmissionInput,
  criteria: CriterionInput[],
): SubmissionScore {
  const byCriterion = new Map(submission.results.map((r) => [r.criterionId, r]));
  const evaluated = submission.jobId != null;

  const humanCriterion = criteria.find((c) => c.checkType === "human_score");
  const humanWeight = humanCriterion?.weight ?? 0;
  const humanMaxScore = humanCriterion
    ? maxPointsFor("human_score", humanCriterion.scoringRules)
    : null;

  const contributions: CriterionContribution[] = [];
  const normByCheck: Partial<Record<CheckType, number>> = {};
  let automatedWeighted = 0;
  let automatedWeight = 0;

  for (const c of criteria) {
    if (c.checkType === "human_score") continue; // handled separately

    const maxPoints = maxPointsFor(c.checkType, c.scoringRules);
    const res = byCriterion.get(c.id);
    const measured = res?.computedScore != null;
    const normalized =
      measured && maxPoints > EPS
        ? clamp01((res!.computedScore as number) / maxPoints)
        : 0;

    automatedWeight += c.weight;
    automatedWeighted += c.weight * normalized;
    if (normByCheck[c.checkType] === undefined) {
      normByCheck[c.checkType] = normalized;
    }

    contributions.push({
      criterionId: c.id,
      name: c.name,
      checkType: c.checkType,
      weight: c.weight,
      rawMetric: res?.rawMetric ?? null,
      computedScore: res?.computedScore ?? null,
      maxPoints,
      normalized,
      weightedContribution: c.weight * normalized,
      measured,
    });
  }

  const technicalScore =
    automatedWeight > EPS ? (100 * automatedWeighted) / automatedWeight : null;

  const humanScored =
    submission.humanScore != null &&
    humanWeight > EPS &&
    humanMaxScore != null &&
    humanMaxScore > EPS;

  const humanNormalized = humanScored
    ? clamp01((submission.humanScore as number) / (humanMaxScore as number))
    : null;

  let finalScore: number | null;
  if (!evaluated || technicalScore === null) {
    finalScore = null;
  } else if (humanScored && humanNormalized != null) {
    finalScore =
      (100 * (automatedWeighted + humanWeight * humanNormalized)) /
      (automatedWeight + humanWeight);
  } else {
    finalScore = technicalScore;
  }

  return {
    submissionId: submission.submissionId,
    teamId: submission.teamId,
    teamName: submission.teamName,
    university: submission.university,
    evaluated,
    jobId: submission.jobId,
    jobStatus: submission.jobStatus,
    submittedAt: new Date(submission.submittedAt).toISOString(),
    contributions,
    automatedWeight,
    humanWeight,
    technicalScore,
    humanScore: submission.humanScore,
    humanMaxScore,
    humanNormalized,
    humanScored,
    finalScore,
    normByCheck,
  };
}

// ---------------------------------------------------------------------------
// Leaderboard & tie-breaks
// ---------------------------------------------------------------------------

export interface RankedEntry extends SubmissionScore {
  rank: number;
  /** True when this entry needed a tie-break to separate it from the one above. */
  tieBrokenWithPrevious: boolean;
}

const normOf = (s: SubmissionScore, ct: CheckType) => s.normByCheck[ct] ?? 0;

/**
 * Ranking comparator (returns <0 if `a` should rank ABOVE `b`).
 *
 * Documented tie-break order — applied only when the prior key is ~equal:
 *   0. Evaluated submissions always rank above unevaluated ones.
 *   1. finalScore (desc) — the headline metric.
 *   2. Performance (desc) — highest lighthouse_perf normalized score wins ties.
 *   3. technicalScore (desc) — stronger automated result overall.
 *   4. Accessibility (desc) — highest lighthouse_a11y normalized score.
 *   5. Reliability (desc) — uptime + build_success normalized, summed.
 *   6. Earliest submission (asc submittedAt) — submitted sooner ranks higher.
 *   7. Team name (asc), then submissionId (asc) — deterministic final tiebreak.
 */
export function compareEntries(a: SubmissionScore, b: SubmissionScore): number {
  if (a.evaluated !== b.evaluated) return a.evaluated ? -1 : 1;

  const fa = a.finalScore ?? -1;
  const fb = b.finalScore ?? -1;
  if (Math.abs(fb - fa) > EPS) return fb - fa;

  const perf = normOf(b, "lighthouse_perf") - normOf(a, "lighthouse_perf");
  if (Math.abs(perf) > EPS) return perf;

  const ta = a.technicalScore ?? -1;
  const tb = b.technicalScore ?? -1;
  if (Math.abs(tb - ta) > EPS) return tb - ta;

  const a11y = normOf(b, "lighthouse_a11y") - normOf(a, "lighthouse_a11y");
  if (Math.abs(a11y) > EPS) return a11y;

  const relA = normOf(a, "uptime") + normOf(a, "build_success");
  const relB = normOf(b, "uptime") + normOf(b, "build_success");
  if (Math.abs(relB - relA) > EPS) return relB - relA;

  const ta2 = new Date(a.submittedAt).getTime();
  const tb2 = new Date(b.submittedAt).getTime();
  if (ta2 !== tb2) return ta2 - tb2;

  const nameCmp = a.teamName.localeCompare(b.teamName);
  if (nameCmp !== 0) return nameCmp;
  return a.submissionId.localeCompare(b.submissionId);
}

/** Sort + assign 1-based ranks. Entries tying on finalScore share nothing —
 *  ranks are strictly increasing — but `tieBrokenWithPrevious` flags where a
 *  tie-break beyond finalScore was needed. */
export function rankSubmissions(scores: SubmissionScore[]): RankedEntry[] {
  const sorted = [...scores].sort(compareEntries);
  return sorted.map((s, i) => {
    const prev = sorted[i - 1];
    const tieBrokenWithPrevious =
      i > 0 &&
      prev.evaluated === s.evaluated &&
      Math.abs((prev.finalScore ?? -1) - (s.finalScore ?? -1)) <= EPS;
    return { ...s, rank: i + 1, tieBrokenWithPrevious };
  });
}

/** Rubric scoring helpers (pure). */

export interface AnchorPoint {
  score: number;
  label: string;
}

export interface CriterionLike {
  id: string;
  weight: number; // integer percent
  scaleMax: number;
}

export interface ScoreLike {
  criterionId: string;
  score: number;
}

export interface CriterionBreakdown {
  criterionId: string;
  score: number;
  scaleMax: number;
  weight: number;
  /** score / scaleMax, in 0..1 */
  normalized: number;
  /** normalized * weight, in 0..weight */
  weighted: number;
}

export interface ScoreCalculation {
  ok: boolean;
  /** 0..100, deterministic. Null when validation fails. */
  finalScore: number | null;
  breakdown: CriterionBreakdown[];
  errors: string[];
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * The single, canonical, deterministic score calculation for ScoreLab.
 *
 * The model provides ONLY per-criterion scores; this backend function owns the
 * weighted math. It validates the inputs, then computes:
 *   weighted_i = (score_i / scaleMax_i) * weight_i        (0..weight_i)
 *   finalScore = Σ weighted_i                             (0..100)
 *
 * Validation (returns ok:false with errors, finalScore:null on any failure):
 *  - rubric weights sum to exactly 100
 *  - rubric criterion ids are unique
 *  - every criterion has exactly one score (none missing, none duplicated)
 *  - no score references a criterion outside the rubric
 *  - every score is an integer within 1..scaleMax
 */
export function calculateFinalScore(
  criteria: CriterionLike[],
  scores: ScoreLike[],
): ScoreCalculation {
  const errors: string[] = [];

  // Unique rubric criteria.
  const critById = new Map<string, CriterionLike>();
  for (const c of criteria) {
    if (critById.has(c.id)) errors.push(`Duplicate rubric criterion id "${c.id}".`);
    critById.set(c.id, c);
  }

  // Weights must total exactly 100.
  const weightSum = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  if (weightSum !== 100) errors.push(`Rubric weights sum to ${weightSum}, expected 100.`);

  // Group scores by criterion (to catch missing / duplicate / unexpected).
  const scoresById = new Map<string, number[]>();
  for (const s of scores) {
    if (!critById.has(s.criterionId)) {
      errors.push(`Score for unknown criterion "${s.criterionId}".`);
      continue;
    }
    const arr = scoresById.get(s.criterionId) ?? [];
    arr.push(s.score);
    scoresById.set(s.criterionId, arr);
  }

  const breakdown: CriterionBreakdown[] = [];
  for (const c of criteria) {
    const arr = scoresById.get(c.id) ?? [];
    if (arr.length === 0) {
      errors.push(`Missing score for criterion "${c.id}".`);
      continue;
    }
    if (arr.length > 1) {
      errors.push(`Criterion "${c.id}" scored ${arr.length} times (must be exactly once).`);
      continue;
    }
    const score = arr[0];
    if (typeof score !== "number" || !Number.isInteger(score)) {
      errors.push(`Score for "${c.id}" must be an integer.`);
      continue;
    }
    if (c.scaleMax <= 0) {
      errors.push(`Criterion "${c.id}" has an invalid scaleMax.`);
      continue;
    }
    if (score < 1 || score > c.scaleMax) {
      errors.push(`Score for "${c.id}" (${score}) is outside 1..${c.scaleMax}.`);
      continue;
    }
    const normalized = score / c.scaleMax;
    breakdown.push({
      criterionId: c.id,
      score,
      scaleMax: c.scaleMax,
      weight: c.weight,
      normalized: round(normalized, 4),
      weighted: round(normalized * c.weight, 2),
    });
  }

  if (errors.length > 0) {
    return { ok: false, finalScore: null, breakdown: [], errors };
  }

  const finalScore = round(
    breakdown.reduce((a, b) => a + (b.score / b.scaleMax) * b.weight, 0),
    1,
  );
  return { ok: true, finalScore, breakdown, errors: [] };
}

/** Coerce/validate stored anchors JSON into a typed array. */
export function parseAnchors(raw: unknown, scaleMax = 5): AnchorPoint[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((a): a is AnchorPoint => !!a && typeof a === "object")
      .map((a) => ({
        score: Number((a as AnchorPoint).score),
        label: String((a as AnchorPoint).label ?? ""),
      }));
  }
  // Fallback: empty anchors for each scale point.
  return Array.from({ length: scaleMax }, (_, i) => ({ score: i + 1, label: "" }));
}

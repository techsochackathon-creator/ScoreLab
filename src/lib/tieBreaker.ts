/**
 * Deterministic tie-resolution engine for ScoreLab.
 *
 * Used ONLY when two or more teams share the exact same final weighted score.
 * The original evaluation scores are NEVER modified — tie-breaking produces
 * a separate ordering that supplements the primary score ranking.
 *
 * Resolution hierarchy (deterministic, configurable):
 *   1. Compare per-criterion scores in priority order (configurable by criterion IDs;
 *      defaults to criterion `order` ascending).
 *   2. If still tied after all criteria: flag for SECONDARY_EVALUATION.
 *   3. If secondary evaluation still tied: TIE_REQUIRES_ORGANIZER_DECISION.
 *
 * Fairness rules — the following factors MUST NEVER influence ranking:
 *   - Random number generation or coin flips
 *   - Submission timestamp
 *   - Team name (alphabetical or otherwise)
 *   - University or institution name
 *   - Number of commits, stars, or forks
 *   - Team size
 *   - Manual score alteration (original scores are immutable)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TiedTeam {
  teamId: string;
  teamName: string;
  totalScore: number;
  /** Per-criterion scores keyed by criterionId. */
  criterionScores: Map<string, number>;
}

export type TieMethod =
  | "CRITERION_HIERARCHY"
  | "SECONDARY_EVALUATION"
  | "ORGANIZER_DECISION"
  | "UNRESOLVED";

export interface TieResolution {
  /** Ordered teamIds, best first. */
  resolvedOrder: string[];
  method: TieMethod;
  /** Which criterion broke the tie (null if not CRITERION_HIERARCHY). */
  resolvedBy: string | null;
  /** Human-readable audit trail. */
  reasoning: string;
  /** True if further resolution is needed (secondary eval or organizer). */
  needsFurtherResolution: boolean;
}

export interface TieGroup {
  score: number;
  teamIds: string[];
}

export interface SecondaryEvalResult {
  teamId: string;
  teamName: string;
  innovation: number;
  realWorldUsefulness: number;
  aiIntegrationQuality: number;
  projectImpact: number;
  reasoning: string;
  evidenceRefs: string[];
  tieBreakScore: number;
}

// ---------------------------------------------------------------------------
// Detect ties
// ---------------------------------------------------------------------------

/**
 * Find groups of teams that share the same final score.
 * Returns only groups with 2+ teams (actual ties).
 */
export function detectTies(
  teams: { teamId: string; totalScore: number }[],
): TieGroup[] {
  const byScore = new Map<number, string[]>();
  for (const t of teams) {
    const key = t.totalScore;
    const arr = byScore.get(key) ?? [];
    arr.push(t.teamId);
    byScore.set(key, arr);
  }
  const ties: TieGroup[] = [];
  for (const [score, teamIds] of byScore) {
    if (teamIds.length >= 2) {
      ties.push({ score, teamIds });
    }
  }
  // Sort by score descending (highest ties resolved first).
  ties.sort((a, b) => b.score - a.score);
  return ties;
}

// ---------------------------------------------------------------------------
// Criterion hierarchy resolution
// ---------------------------------------------------------------------------

/**
 * Attempt to break a tie using per-criterion scores in priority order.
 *
 * For each criterion (highest priority first), compare all tied teams' scores.
 * The team with the higher score on the first differentiating criterion wins.
 * If multiple sub-groups form, recurse on remaining criteria.
 *
 * @param teams - The tied teams with their criterion scores.
 * @param priorityOrder - Ordered criterion IDs, highest priority first.
 * @returns Resolution result. If all criteria exhausted without breaking,
 *          `needsFurtherResolution` is true.
 */
export function resolveByHierarchy(
  teams: TiedTeam[],
  priorityOrder: string[],
): TieResolution {
  if (teams.length <= 1) {
    return {
      resolvedOrder: teams.map((t) => t.teamId),
      method: "CRITERION_HIERARCHY",
      resolvedBy: null,
      reasoning: "Single team — no tie to resolve.",
      needsFurtherResolution: false,
    };
  }

  const auditSteps: string[] = [];
  auditSteps.push(
    `Tie detected: ${teams.length} teams with score ${teams[0].totalScore}. ` +
    `Teams: ${teams.map((t) => t.teamName).join(", ")}.`,
  );

  // Try each criterion in priority order.
  let remaining = [...teams];
  const resolved: string[] = [];

  for (const criterionId of priorityOrder) {
    if (remaining.length <= 1) break;

    // Get scores for this criterion.
    const withScores = remaining.map((t) => ({
      team: t,
      score: t.criterionScores.get(criterionId) ?? 0,
    }));

    // Sort descending by this criterion's score.
    withScores.sort((a, b) => b.score - a.score);

    // Check if this criterion differentiates anyone.
    const scores = withScores.map((w) => w.score);
    const allSame = scores.every((s) => s === scores[0]);

    if (allSame) {
      auditSteps.push(
        `Criterion ${criterionId}: all teams scored ${scores[0]} — no differentiation.`,
      );
      continue;
    }

    // This criterion differentiates. Group by score.
    const groups = new Map<number, TiedTeam[]>();
    for (const w of withScores) {
      const arr = groups.get(w.score) ?? [];
      arr.push(w.team);
      groups.set(w.score, arr);
    }

    // Process groups from highest score to lowest.
    const sortedScores = [...groups.keys()].sort((a, b) => b - a);
    const newRemaining: TiedTeam[] = [];

    for (const score of sortedScores) {
      const group = groups.get(score)!;
      if (group.length === 1) {
        resolved.push(group[0].teamId);
        auditSteps.push(
          `Criterion ${criterionId}: ${group[0].teamName} leads with score ${score}.`,
        );
      } else {
        // Sub-group still tied on this criterion — push to remaining.
        newRemaining.push(...group);
        auditSteps.push(
          `Criterion ${criterionId}: ${group.map((t) => t.teamName).join(", ")} ` +
          `tied at score ${score} — continue to next criterion.`,
        );
      }
    }

    // Update remaining to reflect only unresolved teams.
    remaining = newRemaining;

    // If only one team left in remaining, it's resolved too.
    if (remaining.length === 1) {
      resolved.push(remaining[0].teamId);
      remaining = [];
    }

    // If all resolved, we're done.
    if (remaining.length === 0) {
      return {
        resolvedOrder: resolved,
        method: "CRITERION_HIERARCHY",
        resolvedBy: criterionId,
        reasoning: auditSteps.join(" "),
        needsFurtherResolution: false,
      };
    }
  }

  // Exhausted all criteria — some teams still tied.
  if (remaining.length > 0) {
    // Add remaining in their current order (but mark as unresolved).
    resolved.push(...remaining.map((t) => t.teamId));
    auditSteps.push(
      `All ${priorityOrder.length} criteria exhausted. ` +
      `${remaining.length} teams remain tied: ${remaining.map((t) => t.teamName).join(", ")}. ` +
      `Flagged for secondary evaluation.`,
    );
    return {
      resolvedOrder: resolved,
      method: "CRITERION_HIERARCHY",
      resolvedBy: null,
      reasoning: auditSteps.join(" "),
      needsFurtherResolution: true,
    };
  }

  return {
    resolvedOrder: resolved,
    method: "CRITERION_HIERARCHY",
    resolvedBy: priorityOrder[priorityOrder.length - 1],
    reasoning: auditSteps.join(" "),
    needsFurtherResolution: false,
  };
}

// ---------------------------------------------------------------------------
// Secondary evaluation resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a tie using results from a secondary AI evaluation.
 *
 * The secondary evaluation scores each team on:
 *   - innovation (1-10)
 *   - realWorldUsefulness (1-10)
 *   - aiIntegrationQuality (1-10)
 *   - projectImpact (1-10)
 *   => tieBreakScore = sum of the four (4-40)
 *
 * If secondary scores still tie: UNRESOLVED → organizer must decide.
 */
export function resolveBySecondaryEval(
  results: SecondaryEvalResult[],
): TieResolution {
  if (results.length <= 1) {
    return {
      resolvedOrder: results.map((r) => r.teamId),
      method: "SECONDARY_EVALUATION",
      resolvedBy: "tieBreakScore",
      reasoning: "Single team — no tie to resolve.",
      needsFurtherResolution: false,
    };
  }

  // Sort by tieBreakScore descending.
  const sorted = [...results].sort((a, b) => b.tieBreakScore - a.tieBreakScore);

  const auditSteps: string[] = [];
  auditSteps.push(
    `Secondary tie evaluation completed for ${results.length} teams.`,
  );

  for (const r of sorted) {
    auditSteps.push(
      `${r.teamName}: innovation=${r.innovation}, usefulness=${r.realWorldUsefulness}, ` +
      `AI-integration=${r.aiIntegrationQuality}, impact=${r.projectImpact}, ` +
      `tieBreakScore=${r.tieBreakScore}.`,
    );
  }

  // Check if all tieBreakScores are equal.
  const allScores = sorted.map((r) => r.tieBreakScore);
  const stillTied = allScores.every((s) => s === allScores[0]);

  if (stillTied) {
    auditSteps.push(
      `All teams received the same tie-break score (${allScores[0]}). ` +
      `Tie cannot be resolved automatically. Flagged: TIE_REQUIRES_ORGANIZER_DECISION.`,
    );
    return {
      resolvedOrder: sorted.map((r) => r.teamId),
      method: "SECONDARY_EVALUATION",
      resolvedBy: null,
      reasoning: auditSteps.join(" "),
      needsFurtherResolution: true,
    };
  }

  // Check for partial ties within secondary.
  const uniqueScores = new Set(allScores);
  if (uniqueScores.size < sorted.length) {
    // Some sub-groups still tied.
    const byScore = new Map<number, SecondaryEvalResult[]>();
    for (const r of sorted) {
      const arr = byScore.get(r.tieBreakScore) ?? [];
      arr.push(r);
      byScore.set(r.tieBreakScore, arr);
    }
    const hasTiedGroup = [...byScore.values()].some((g) => g.length > 1);
    if (hasTiedGroup) {
      auditSteps.push(
        `Partial tie remains in secondary scores. Tied sub-groups flagged: TIE_REQUIRES_ORGANIZER_DECISION.`,
      );
      return {
        resolvedOrder: sorted.map((r) => r.teamId),
        method: "SECONDARY_EVALUATION",
        resolvedBy: "tieBreakScore",
        reasoning: auditSteps.join(" "),
        needsFurtherResolution: true,
      };
    }
  }

  auditSteps.push(
    `Tie resolved by secondary evaluation. Winner: ${sorted[0].teamName} ` +
    `(tieBreakScore ${sorted[0].tieBreakScore}).`,
  );

  return {
    resolvedOrder: sorted.map((r) => r.teamId),
    method: "SECONDARY_EVALUATION",
    resolvedBy: "tieBreakScore",
    reasoning: auditSteps.join(" "),
    needsFurtherResolution: false,
  };
}

// ---------------------------------------------------------------------------
// Organizer manual resolution
// ---------------------------------------------------------------------------

/**
 * Record an organizer's manual tie-resolution decision.
 */
export function resolveByOrganizer(
  teamIds: string[],
  resolvedOrder: string[],
  note: string,
): TieResolution {
  // Validate that resolvedOrder contains exactly the tied teams.
  const inputSet = new Set(teamIds);
  const orderSet = new Set(resolvedOrder);
  if (inputSet.size !== orderSet.size || ![...inputSet].every((id) => orderSet.has(id))) {
    throw new Error(
      "Organizer resolution must include exactly the tied teams, no more and no less.",
    );
  }

  return {
    resolvedOrder,
    method: "ORGANIZER_DECISION",
    resolvedBy: null,
    reasoning: `Organizer decision: ${note}`,
    needsFurtherResolution: false,
  };
}

// ---------------------------------------------------------------------------
// Apply tie-break results to snapshot
// ---------------------------------------------------------------------------

export interface RankedTeam {
  teamId: string;
  teamName: string;
  totalScore: number;
  rank: number;
  tieBreakRank?: number;
  tieBreakMethod?: TieMethod;
  tieBreakResolvedBy?: string | null;
}

/**
 * Apply tie-break resolutions to assign unique ranks.
 *
 * Teams are first sorted by totalScore descending. Ties are resolved using
 * the provided resolutions map (keyed by score). Teams without a resolution
 * for their tie retain the same rank (dense ranking).
 */
export function applyTieBreaks(
  teams: { teamId: string; teamName: string; totalScore: number }[],
  resolutions: Map<number, TieResolution>,
): RankedTeam[] {
  // Sort by score descending.
  const sorted = [...teams].sort((a, b) => b.totalScore - a.totalScore);

  // Group by score.
  const groups = new Map<number, typeof sorted>();
  for (const t of sorted) {
    const arr = groups.get(t.totalScore) ?? [];
    arr.push(t);
    groups.set(t.totalScore, arr);
  }

  const result: RankedTeam[] = [];
  let rank = 1;

  // Process groups in score-descending order.
  const scores = [...groups.keys()].sort((a, b) => b - a);

  for (const score of scores) {
    const group = groups.get(score)!;

    if (group.length === 1) {
      result.push({
        teamId: group[0].teamId,
        teamName: group[0].teamName,
        totalScore: group[0].totalScore,
        rank,
      });
      rank++;
      continue;
    }

    // Tie group — check for resolution.
    const resolution = resolutions.get(score);
    if (!resolution) {
      // No resolution available — assign same rank (dense).
      for (const t of group) {
        result.push({
          teamId: t.teamId,
          teamName: t.teamName,
          totalScore: t.totalScore,
          rank,
        });
      }
      rank += group.length;
      continue;
    }

    // Apply resolved order.
    const orderMap = new Map(
      resolution.resolvedOrder.map((id, i) => [id, i]),
    );
    const orderedGroup = [...group].sort((a, b) => {
      const ai = orderMap.get(a.teamId) ?? Infinity;
      const bi = orderMap.get(b.teamId) ?? Infinity;
      return ai - bi;
    });

    for (let i = 0; i < orderedGroup.length; i++) {
      result.push({
        teamId: orderedGroup[i].teamId,
        teamName: orderedGroup[i].teamName,
        totalScore: orderedGroup[i].totalScore,
        rank: rank + i,
        tieBreakRank: i + 1,
        tieBreakMethod: resolution.method,
        tieBreakResolvedBy: resolution.resolvedBy,
      });
    }
    rank += orderedGroup.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build criterion scores map from submission data
// ---------------------------------------------------------------------------

/**
 * Build a TiedTeam from submission/criterion score data.
 */
export function buildTiedTeam(
  teamId: string,
  teamName: string,
  totalScore: number,
  criterionScores: { criterionId: string; score: number }[],
): TiedTeam {
  return {
    teamId,
    teamName,
    totalScore,
    criterionScores: new Map(criterionScores.map((cs) => [cs.criterionId, cs.score])),
  };
}

/**
 * Get the default tie-break priority order from criteria sorted by `order` field.
 */
export function defaultPriorityOrder(
  criteria: { id: string; order: number }[],
): string[] {
  return [...criteria].sort((a, b) => a.order - b.order).map((c) => c.id);
}

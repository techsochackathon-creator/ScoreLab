import type { CheckType } from "@prisma/client";
import {
  CHECK_TYPE_META,
  getScoringRulesSchema,
  defaultScoringRules,
  maxPointsFor,
  type LighthouseRules,
  type UptimeRules,
  type ResponsivenessRules,
  type BuildSuccessRules,
  type CodeQualityRules,
  type HumanScoreRules,
} from "@/lib/scoringRules";

export interface CriterionExplanation {
  title: string; // human label for the checkType
  blurb: string; // one-line plain-language description
  automated: boolean;
  weightPct: number;
  maxPoints: number;
  /** Plain-language bullets describing how points are awarded. */
  rules: string[];
}

/**
 * Turn a criterion's checkType + scoringRules into a plain-language explanation
 * for the public methodology page. Pure — reads from the same schemas the
 * evaluator and aggregator use, so the docs can't drift from the scoring.
 */
export function explainCriterion(
  checkType: CheckType,
  scoringRules: unknown,
  weight: number,
): CriterionExplanation {
  const meta = CHECK_TYPE_META[checkType];
  const parsed = getScoringRulesSchema(checkType).safeParse(scoringRules);
  const r = parsed.success ? parsed.data : defaultScoringRules(checkType);
  const maxPoints = maxPointsFor(checkType, scoringRules);

  const base = {
    title: meta.label,
    blurb: meta.description,
    automated: meta.automated,
    weightPct: Math.round(weight * 1000) / 10,
    maxPoints,
  };

  switch (checkType) {
    case "uptime": {
      const u = r as UptimeRules;
      return {
        ...base,
        rules: [
          `We send ${u.pings} request(s) to the team's live URL (timeout ${u.timeoutMs} ms).`,
          `${u.passPoints} points if it responds with HTTP 200–399, otherwise ${u.failPoints}.`,
        ],
      };
    }
    case "build_success": {
      const b = r as BuildSuccessRules;
      return {
        ...base,
        rules: [
          "We clone the repo into an isolated sandbox and run the manifest's install and start commands.",
          `${b.passPoints} points if it installs and the server starts, otherwise ${b.failPoints}.`,
        ],
      };
    }
    case "lighthouse_perf":
    case "lighthouse_a11y": {
      const l = r as LighthouseRules;
      const metric =
        checkType === "lighthouse_perf" ? "performance" : "accessibility";
      if (l.mode === "raw") {
        return {
          ...base,
          rules: [
            `We run Google Lighthouse against the live URL and take the ${metric} score (0–100).`,
            `That score is scaled directly to points (max ${l.maxPoints}) and then by this criterion's weight.`,
          ],
        };
      }
      const bands = [...l.bands]
        .sort((a, b) => b.min - a.min)
        .map((band) => `score ≥ ${band.min} → ${band.score} pts`);
      return {
        ...base,
        rules: [
          `We run Google Lighthouse against the live URL and take the ${metric} score (0–100).`,
          `Points are awarded in bands: ${bands.join("; ")}.`,
        ],
      };
    }
    case "responsiveness": {
      const rr = r as ResponsivenessRules;
      return {
        ...base,
        rules: [
          `We load the live app in a headless browser at ${rr.viewports
            .map((w) => `${w}px`)
            .join(", ")}.`,
          `${rr.pointsPerViewport} points for each width that renders without horizontal overflow or errors (max ${maxPoints}).`,
        ],
      };
    }
    case "code_quality": {
      const cq = r as CodeQualityRules;
      const items = cq.subChecks
        .filter((s) => s.enabled)
        .map((s) =>
          s.minCommitsPerTeammate !== undefined
            ? `${s.label} (≥ ${s.minCommitsPerTeammate} commits per teammate): ${s.points} pts`
            : `${s.label}: ${s.points} pts`,
        );
      return {
        ...base,
        rules: [
          "We inspect the repository for the following, awarding points for each:",
          ...items,
        ],
      };
    }
    case "human_score": {
      const h = r as HumanScoreRules;
      return {
        ...base,
        rules: [
          `A judge scores the project from 0 to ${h.maxScore}.`,
          "This is combined with the automated score using this criterion's weight, once entered.",
        ],
      };
    }
    default: {
      const _exhaustive: never = checkType;
      return { ...base, rules: [String(_exhaustive)] };
    }
  }
}

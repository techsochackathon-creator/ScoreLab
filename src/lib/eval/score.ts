import type { CheckType } from "@prisma/client";
import {
  getScoringRulesSchema,
  defaultScoringRules,
  type LighthouseRules,
  type UptimeRules,
  type ResponsivenessRules,
  type BuildSuccessRules,
  type CodeQualityRules,
  type HumanScoreRules,
} from "@/lib/scoringRules";
import type { EvalMetrics } from "./types";

export interface ScoreOutput {
  rawMetric: number | null;
  computedScore: number | null;
  details: Record<string, unknown>;
}

/**
 * Map a criterion (checkType + scoringRules) and the gathered metrics to a
 * raw metric + computed points. Scores are expressed in the criterion's own
 * "points" (per the rubric builder); weighted aggregation happens later.
 */
export function scoreCriterion(
  checkType: CheckType,
  scoringRules: unknown,
  m: EvalMetrics,
): ScoreOutput {
  const parsed = getScoringRulesSchema(checkType).safeParse(scoringRules);
  const rules = parsed.success ? parsed.data : defaultScoringRules(checkType);

  switch (checkType) {
    case "build_success": {
      const r = rules as BuildSuccessRules;
      const pass = m.build.installExit === 0 && m.build.startReachable;
      return {
        rawMetric: m.build.installExit ?? null,
        computedScore: pass ? r.passPoints : r.failPoints,
        details: {
          pass,
          installExit: m.build.installExit,
          startReachable: m.build.startReachable,
          startHttpCode: m.build.startHttpCode,
          logsTail: m.build.logsTail,
        },
      };
    }

    case "uptime": {
      const r = rules as UptimeRules;
      if (!m.uptime.checked) {
        return {
          rawMetric: null,
          computedScore: r.failPoints,
          details: { note: "no liveUrl provided" },
        };
      }
      const status = m.uptime.httpStatus;
      const up = status != null && status >= 200 && status < 400;
      return {
        rawMetric: status,
        computedScore: up ? r.passPoints : r.failPoints,
        details: { up, httpStatus: status, responseMs: m.uptime.responseMs },
      };
    }

    case "lighthouse_perf":
    case "lighthouse_a11y": {
      const r = rules as LighthouseRules;
      const score =
        checkType === "lighthouse_perf"
          ? m.lighthouse.performance
          : m.lighthouse.accessibility;
      if (score == null) {
        return {
          rawMetric: null,
          computedScore: null,
          details: { note: "no liveUrl / Lighthouse unavailable" },
        };
      }
      if (r.mode === "raw") {
        return {
          rawMetric: score,
          computedScore: (score / 100) * r.maxPoints,
          details: { mode: "raw", score, maxPoints: r.maxPoints },
        };
      }
      // bands: highest band whose min the score meets.
      const band = [...r.bands]
        .sort((a, b) => b.min - a.min)
        .find((b) => score >= b.min);
      return {
        rawMetric: score,
        computedScore: band ? band.score : 0,
        details: { mode: "bands", score, matchedBand: band ?? null },
      };
    }

    case "responsiveness": {
      const r = rules as ResponsivenessRules;
      const configured = new Set(r.viewports);
      const considered = m.responsiveness.viewports.filter((v) =>
        configured.has(v.width),
      );
      const passing = considered.filter((v) => v.ok).length;
      return {
        rawMetric: passing,
        computedScore: passing * r.pointsPerViewport,
        details: {
          pointsPerViewport: r.pointsPerViewport,
          passing,
          tested: considered.length,
          viewports: considered,
        },
      };
    }

    case "code_quality": {
      const r = rules as CodeQualityRules;
      let total = 0;
      let passed = 0;
      const perCheck = r.subChecks.map((s) => {
        if (!s.enabled) {
          return { ...s, passed: false, skipped: true };
        }
        let ok = false;
        if (s.minCommitsPerTeammate !== undefined) {
          ok =
            m.codeQuality.authorship.authors > 0 &&
            m.codeQuality.authorship.minCommits >= s.minCommitsPerTeammate;
        } else if (/readme/i.test(s.key) || /readme/i.test(s.label)) {
          ok = m.codeQuality.readme;
        } else if (/test/i.test(s.key) || /test/i.test(s.label)) {
          ok = m.codeQuality.tests;
        } else {
          ok = false; // unknown/custom sub-check: not automatable
        }
        if (ok) {
          total += s.points;
          passed += 1;
        }
        return { key: s.key, label: s.label, points: s.points, passed: ok };
      });
      return {
        rawMetric: passed,
        computedScore: total,
        details: { subChecks: perCheck, authorship: m.codeQuality.authorship },
      };
    }

    case "human_score": {
      const r = rules as HumanScoreRules;
      return {
        rawMetric: null,
        computedScore: null,
        details: { awaiting: "judge", maxScore: r.maxScore },
      };
    }

    default: {
      const _exhaustive: never = checkType;
      return { rawMetric: null, computedScore: null, details: { _exhaustive } };
    }
  }
}

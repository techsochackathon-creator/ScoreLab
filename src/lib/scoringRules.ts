import { z } from "zod";
import type { CheckType } from "@prisma/client";

/**
 * Per-checkType scoring-rules definitions, shared by the organizer rubric
 * editor (client) and the submission/rubric APIs (server).
 *
 * Each criterion stores a `scoringRules` JSON blob whose shape depends on its
 * `checkType`. The Zod schemas below both validate incoming config and supply
 * defaults, and `defaultScoringRules()` seeds the editor when a checkType is
 * chosen.
 */

export const CHECK_TYPES = [
  "uptime",
  "lighthouse_perf",
  "lighthouse_a11y",
  "responsiveness",
  "build_success",
  "code_quality",
  "human_score",
] as const;

// Compile-time guarantee that CHECK_TYPES stays in sync with the Prisma enum.
const _assertCheckTypes: readonly CheckType[] = CHECK_TYPES;
void _assertCheckTypes;

export interface CheckTypeMeta {
  label: string;
  automated: boolean;
  description: string;
}

export const CHECK_TYPE_META: Record<CheckType, CheckTypeMeta> = {
  uptime: {
    label: "Uptime",
    automated: true,
    description: "Ping the live URL; award points if it responds.",
  },
  lighthouse_perf: {
    label: "Lighthouse — Performance",
    automated: true,
    description: "Lighthouse performance score (0–100).",
  },
  lighthouse_a11y: {
    label: "Lighthouse — Accessibility",
    automated: true,
    description: "Lighthouse accessibility score (0–100).",
  },
  responsiveness: {
    label: "Responsiveness",
    automated: true,
    description: "Render the live URL at chosen viewport widths.",
  },
  build_success: {
    label: "Build success",
    automated: true,
    description: "Run the manifest install/run commands; pass or fail.",
  },
  code_quality: {
    label: "Code quality",
    automated: true,
    description: "Repository checklist (README, tests, commit activity…).",
  },
  human_score: {
    label: "Judge score (manual)",
    automated: false,
    description: "Score entered by a human judge during review.",
  },
};

// ---------------------------------------------------------------------------
// Per-checkType Zod schemas
// ---------------------------------------------------------------------------

const points = z.number().finite().min(0).max(1000);
const percent = z.number().finite().min(0).max(100);

/** lighthouse_perf & lighthouse_a11y share this shape. */
export const lighthouseRulesSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("raw"),
    // score = rawLighthouseScore, contributes proportionally via the weight.
    maxPoints: points.default(100),
  }),
  z.object({
    mode: z.literal("bands"),
    bands: z
      .array(
        z.object({
          // Award `score` when the raw metric is >= min.
          min: percent,
          score: points,
        }),
      )
      .min(1, "add at least one band"),
  }),
]);

export const uptimeRulesSchema = z.object({
  passPoints: points.default(100),
  failPoints: points.default(0),
  pings: z.number().int().min(1).max(20).default(3),
  timeoutMs: z.number().int().min(500).max(60000).default(5000),
});

export const responsivenessRulesSchema = z.object({
  viewports: z
    .array(z.number().int().min(240).max(3840))
    .min(1, "select at least one viewport width"),
  pointsPerViewport: points.default(25),
});

export const buildSuccessRulesSchema = z.object({
  passPoints: points.default(100),
  failPoints: points.default(0),
});

export const codeQualitySubCheckSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  points: points,
  // Only meaningful for the "min commits per teammate" sub-check.
  minCommitsPerTeammate: z.number().int().min(1).max(1000).optional(),
});

export const codeQualityRulesSchema = z.object({
  subChecks: z.array(codeQualitySubCheckSchema).min(1, "add at least one sub-check"),
});

export const humanScoreRulesSchema = z.object({
  maxScore: z.number().finite().min(1).max(1000).default(10),
});

export type LighthouseRules = z.infer<typeof lighthouseRulesSchema>;
export type UptimeRules = z.infer<typeof uptimeRulesSchema>;
export type ResponsivenessRules = z.infer<typeof responsivenessRulesSchema>;
export type BuildSuccessRules = z.infer<typeof buildSuccessRulesSchema>;
export type CodeQualitySubCheck = z.infer<typeof codeQualitySubCheckSchema>;
export type CodeQualityRules = z.infer<typeof codeQualityRulesSchema>;
export type HumanScoreRules = z.infer<typeof humanScoreRulesSchema>;

/** Return the Zod schema that validates scoringRules for a given checkType. */
export function getScoringRulesSchema(checkType: CheckType): z.ZodTypeAny {
  switch (checkType) {
    case "uptime":
      return uptimeRulesSchema;
    case "lighthouse_perf":
    case "lighthouse_a11y":
      return lighthouseRulesSchema;
    case "responsiveness":
      return responsivenessRulesSchema;
    case "build_success":
      return buildSuccessRulesSchema;
    case "code_quality":
      return codeQualityRulesSchema;
    case "human_score":
      return humanScoreRulesSchema;
    default: {
      const _exhaustive: never = checkType;
      return _exhaustive;
    }
  }
}

/** Suggested widths offered in the responsiveness editor. */
export const RESPONSIVENESS_PRESETS = [320, 375, 414, 768, 1024, 1280, 1440] as const;

/** Fresh, valid scoringRules for a newly selected checkType. */
export function defaultScoringRules(checkType: CheckType): unknown {
  switch (checkType) {
    case "uptime":
      return { passPoints: 100, failPoints: 0, pings: 3, timeoutMs: 5000 };
    case "lighthouse_perf":
    case "lighthouse_a11y":
      return { mode: "raw", maxPoints: 100 };
    case "responsiveness":
      return { viewports: [375, 768, 1024, 1440], pointsPerViewport: 25 };
    case "build_success":
      return { passPoints: 100, failPoints: 0 };
    case "code_quality":
      return {
        subChecks: [
          { key: "readme", label: "README present", enabled: true, points: 10 },
          { key: "tests", label: "Tests present", enabled: true, points: 15 },
          {
            key: "commits",
            label: "Min commits per teammate",
            enabled: true,
            points: 10,
            minCommitsPerTeammate: 3,
          },
        ],
      };
    case "human_score":
      return { maxScore: 10 };
    default: {
      const _exhaustive: never = checkType;
      return _exhaustive;
    }
  }
}

/**
 * Maximum points a criterion can earn under its scoringRules. Used by the
 * aggregation service to normalize a computed score into [0, 1] before
 * applying the criterion's weight. Returns 0 when no positive maximum exists
 * (callers must guard against divide-by-zero).
 */
export function maxPointsFor(
  checkType: CheckType,
  scoringRules: unknown,
): number {
  const parsed = getScoringRulesSchema(checkType).safeParse(scoringRules);
  const r = parsed.success ? parsed.data : defaultScoringRules(checkType);

  switch (checkType) {
    case "uptime": {
      const u = r as UptimeRules;
      return Math.max(u.passPoints, u.failPoints, 0);
    }
    case "build_success": {
      const b = r as BuildSuccessRules;
      return Math.max(b.passPoints, b.failPoints, 0);
    }
    case "lighthouse_perf":
    case "lighthouse_a11y": {
      const l = r as LighthouseRules;
      return l.mode === "raw"
        ? l.maxPoints
        : Math.max(0, ...l.bands.map((band) => band.score));
    }
    case "responsiveness": {
      const rr = r as ResponsivenessRules;
      return rr.viewports.length * rr.pointsPerViewport;
    }
    case "code_quality": {
      const cq = r as CodeQualityRules;
      return cq.subChecks
        .filter((s) => s.enabled)
        .reduce((sum, s) => sum + s.points, 0);
    }
    case "human_score": {
      return (r as HumanScoreRules).maxScore;
    }
    default: {
      const _exhaustive: never = checkType;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Whole-rubric validation
// ---------------------------------------------------------------------------

export const WEIGHT_SUM_TARGET = 100;
export const WEIGHT_EPSILON = 0.01;

export const criterionInputSchema = z.object({
  name: z.string().trim().min(1, "criterion name is required"),
  checkType: z.enum(CHECK_TYPES),
  weightPercent: z.number().finite().min(0).max(100),
  scoringRules: z.unknown(),
});

export const rubricSaveSchema = z.object({
  trackId: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  criteria: z.array(criterionInputSchema).min(1, "add at least one criterion"),
});

export type RubricSaveInput = z.infer<typeof rubricSaveSchema>;
export type CriterionInput = z.infer<typeof criterionInputSchema>;

export interface CriterionValidationError {
  index: number;
  field: "name" | "weight" | "scoringRules";
  message: string;
}

export interface RubricValidationResult {
  ok: boolean;
  weightSum: number;
  errors: CriterionValidationError[];
  formError?: string;
  /** Criteria with scoringRules normalized through their schema. */
  normalized?: CriterionInput[];
}

/**
 * Cross-criterion validation shared by client and server: weights sum to 100,
 * names are unique, and each criterion's scoringRules match its checkType.
 */
export function validateRubricCriteria(
  criteria: CriterionInput[],
): RubricValidationResult {
  const errors: CriterionValidationError[] = [];
  const seen = new Map<string, number>();
  const normalized: CriterionInput[] = [];

  let weightSum = 0;
  criteria.forEach((c, index) => {
    weightSum += Number.isFinite(c.weightPercent) ? c.weightPercent : 0;

    const key = c.name.trim().toLowerCase();
    if (key && seen.has(key)) {
      errors.push({ index, field: "name", message: "duplicate criterion name" });
    } else if (key) {
      seen.set(key, index);
    }

    const parsed = getScoringRulesSchema(c.checkType).safeParse(c.scoringRules);
    if (!parsed.success) {
      errors.push({
        index,
        field: "scoringRules",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
      normalized.push(c);
    } else {
      normalized.push({ ...c, scoringRules: parsed.data });
    }
  });

  let formError: string | undefined;
  if (Math.abs(weightSum - WEIGHT_SUM_TARGET) > WEIGHT_EPSILON) {
    formError = `Weights must sum to 100% (currently ${weightSum.toFixed(1)}%).`;
  }

  return {
    ok: errors.length === 0 && !formError,
    weightSum,
    errors,
    formError,
    normalized: errors.length === 0 ? normalized : undefined,
  };
}

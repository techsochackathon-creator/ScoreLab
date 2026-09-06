/**
 * Strict validation for Gemini's structured evaluation output.
 *
 * The model returns, for every rubric criterion:
 *   { criterionId, score, confidence, reasoning, evidenceRefs }
 *
 * This module parses + validates that output against the rubric and the actual
 * evidence. On any failure the caller must NOT finalize the evaluation; it marks
 * the submission REVIEW_REQUIRED with an INVALID_AI_OUTPUT flag and preserves the
 * raw response. The weighted final score is computed server-side elsewhere — the
 * model never provides (and must not be able to derive) it.
 */

export type ValidationCode =
  | "MALFORMED_JSON"
  | "SCHEMA_INVALID"
  | "FORBIDDEN_FINAL_SCORE"
  | "MISSING_CRITERION"
  | "DUPLICATE_CRITERION"
  | "UNEXPECTED_CRITERION"
  | "INVALID_SCORE_TYPE"
  | "SCORE_OUT_OF_RANGE"
  | "INVALID_CONFIDENCE"
  | "EMPTY_REASONING"
  | "MISSING_EVIDENCE"
  | "HALLUCINATED_EVIDENCE";

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  criterionId?: string;
}

export interface ValidatedCriterionScore {
  criterionId: string;
  score: number;
  confidence: number;
  reasoning: string;
  evidenceRefs: string[];
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  scores?: ValidatedCriterionScore[]; // only when valid
}

export interface RubricCriterionSpec {
  id: string;
  name: string;
  scaleMax: number;
}

export interface ValidateOptions {
  criteria: RubricCriterionSpec[];
  /** Known file paths from the evidence, for hallucinated-evidence detection. */
  knownFiles?: string[];
  hasReadme?: boolean;
}

const FINAL_SCORE_KEY_RE = /(total|final|weighted|overall).*score|^(total|final|weighted|overall)$|^score$/i;
const MIN_REASONING_LEN = 10;

const FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|py|go|java|rb|rs|php|json|ya?ml|md|txt|toml|lock|gradle|xml|cfg|ini|env|sh|css|scss|html|vue|svelte|c|cc|cpp|h|hpp|cs|kt|swift)$/i;

const basename = (p: string) => p.split("/").pop() ?? p;

/** Does an evidence reference point at a concrete file (vs. a descriptor)? */
function looksLikeFileRef(ref: string): boolean {
  return ref.includes("/") || FILE_EXT_RE.test(ref.trim());
}

/** Rubric weights precondition (requirement #9): must total 100%. */
export function validateRubricWeights(criteria: { weight: number }[]): {
  valid: boolean;
  sum: number;
} {
  const sum = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  return { valid: sum === 100, sum };
}

export function validateAiOutput(raw: unknown, opts: ValidateOptions): ValidationResult {
  const issues: ValidationIssue[] = [];
  const fail = (): ValidationResult => ({ valid: false, issues });

  // (7) JSON must be well-formed.
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      issues.push({ code: "MALFORMED_JSON", message: "Model output is not valid JSON." });
      return fail();
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    issues.push({ code: "SCHEMA_INVALID", message: "Output must be a JSON object." });
    return fail();
  }
  const root = obj as Record<string, unknown>;

  // (8) The model must not emit a final/total/weighted score.
  for (const key of Object.keys(root)) {
    if (key !== "scores" && FINAL_SCORE_KEY_RE.test(key)) {
      issues.push({ code: "FORBIDDEN_FINAL_SCORE", message: `Output must not contain a final/total score field ("${key}").` });
    }
  }

  const arr = root.scores;
  if (!Array.isArray(arr)) {
    issues.push({ code: "SCHEMA_INVALID", message: "Output must contain a 'scores' array." });
    return fail();
  }

  const specById = new Map(opts.criteria.map((c) => [c.id, c]));
  const knownPaths = new Set((opts.knownFiles ?? []).map((p) => p.toLowerCase()));
  const knownBases = new Set((opts.knownFiles ?? []).map((p) => basename(p).toLowerCase()));

  const seen = new Set<string>();
  const collected: ValidatedCriterionScore[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push({ code: "SCHEMA_INVALID", message: "Each score entry must be an object." });
      continue;
    }
    const it = item as Record<string, unknown>;
    const id = it.criterionId;

    // (6) Only known criterion IDs are accepted.
    if (typeof id !== "string" || !specById.has(id)) {
      issues.push({ code: "UNEXPECTED_CRITERION", message: `Unknown or missing criterionId: ${JSON.stringify(id)}` });
      continue;
    }
    if (seen.has(id)) {
      issues.push({ code: "DUPLICATE_CRITERION", message: `Duplicate entry for criterion.`, criterionId: id });
      continue;
    }
    seen.add(id);
    const spec = specById.get(id)!;

    // (2) score: integer within 1..scaleMax.
    const score = it.score;
    if (typeof score !== "number" || Number.isNaN(score) || !Number.isInteger(score)) {
      issues.push({ code: "INVALID_SCORE_TYPE", message: "score must be an integer.", criterionId: id });
    } else if (score < 1 || score > spec.scaleMax) {
      issues.push({ code: "SCORE_OUT_OF_RANGE", message: `score must be between 1 and ${spec.scaleMax}.`, criterionId: id });
    }

    // (5) confidence: number in [0, 1].
    const confidence = it.confidence;
    if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      issues.push({ code: "INVALID_CONFIDENCE", message: "confidence must be a number between 0 and 1.", criterionId: id });
    }

    // (3) reasoning: non-empty.
    const reasoning = it.reasoning;
    if (typeof reasoning !== "string" || reasoning.trim().length < MIN_REASONING_LEN) {
      issues.push({ code: "EMPTY_REASONING", message: "reasoning is missing or too short.", criterionId: id });
    }

    // (4) evidenceRefs: non-empty array of strings; (hallucination) file refs must exist.
    const refs = it.evidenceRefs;
    if (!Array.isArray(refs) || refs.length === 0 || !refs.every((r) => typeof r === "string" && r.trim().length > 0)) {
      issues.push({ code: "MISSING_EVIDENCE", message: "evidenceRefs must be a non-empty array of strings.", criterionId: id });
    } else if (opts.knownFiles) {
      for (const ref of refs as string[]) {
        const r = ref.trim();
        if (/readme/i.test(basename(r)) && opts.hasReadme) continue; // README always allowed when present
        if (!looksLikeFileRef(r)) continue; // descriptive ref ("commit history") — allowed
        const lower = r.toLowerCase();
        const known =
          knownPaths.has(lower) ||
          knownBases.has(basename(lower)) ||
          [...knownPaths].some((p) => p.endsWith("/" + lower) || p.includes(lower));
        if (!known) {
          issues.push({ code: "HALLUCINATED_EVIDENCE", message: `Cited evidence not found in the repository: "${ref}".`, criterionId: id });
        }
      }
    }

    collected.push({
      criterionId: id,
      score: typeof score === "number" ? score : 0,
      confidence: typeof confidence === "number" ? confidence : 0,
      reasoning: typeof reasoning === "string" ? reasoning : "",
      evidenceRefs: Array.isArray(refs) ? (refs as unknown[]).filter((r): r is string => typeof r === "string") : [],
    });
  }

  // (1) Every rubric criterion must be present.
  for (const c of opts.criteria) {
    if (!seen.has(c.id)) {
      issues.push({ code: "MISSING_CRITERION", message: `Missing score for criterion "${c.name}".`, criterionId: c.id });
    }
  }

  return issues.length === 0 ? { valid: true, issues, scores: collected } : fail();
}

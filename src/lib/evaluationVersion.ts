import { createHash } from "node:crypto";

/**
 * Evaluation versioning helpers (pure).
 *
 * Every evaluation run is captured as an immutable record. Re-runs append a new
 * record; older records are never mutated. These helpers build the record and a
 * stable, content-based rubric version hash.
 */

export interface RubricForHash {
  name: string;
  criteria: { name: string; description: string; weight: number; scaleMax: number; anchors: unknown }[];
}

/**
 * Content-based rubric version hash. Stable across saves with identical content
 * (ignores database ids), and different whenever any criterion content or weight
 * changes — so distinct rubric versions are distinguishable.
 */
export function rubricVersionHash(rubric: RubricForHash): string {
  const canonical = {
    name: rubric.name,
    criteria: rubric.criteria
      .map((c) => ({
        name: c.name,
        description: c.description,
        weight: c.weight,
        scaleMax: c.scaleMax,
        anchors: c.anchors,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  return "rub_" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}

export interface CriterionScoreSnapshot {
  criterionId: string;
  name: string;
  score: number;
  weight: number;
  scaleMax: number;
  weighted: number;
  confidence: number;
  reasoning: string;
  evidenceRefs: string[];
}

export interface RunRecordInput {
  submissionId: string;
  teamId: string;
  repoUrl: string;
  commitSha?: string | null;
  evidenceFetchedAt?: Date | null;
  rubricVersion: string;
  promptVersion: string;
  model?: string | null;
  modelConfig?: Record<string, unknown> | null;
  status: string;
  finalScore?: number | null;
  confidence?: number | null;
  flags?: string[];
  error?: string | null;
  criterionScores?: CriterionScoreSnapshot[] | null;
  rawEvidence?: unknown;
  sanitizedEvidence?: unknown;
  startedAt: Date;
  completedAt: Date;
}

export interface RunRecord extends Required<Omit<RunRecordInput, "model" | "modelConfig" | "commitSha" | "evidenceFetchedAt" | "finalScore" | "confidence" | "error" | "criterionScores" | "rawEvidence" | "sanitizedEvidence" | "flags">> {
  commitSha: string | null;
  evidenceFetchedAt: Date | null;
  model: string | null;
  modelConfig: Record<string, unknown> | null;
  finalScore: number | null;
  confidence: number | null;
  flags: string[];
  error: string | null;
  criterionScores: CriterionScoreSnapshot[] | null;
  rawEvidence: unknown;
  sanitizedEvidence: unknown;
  /** For completed runs, mirrors finalScore (kept for trend readers). */
  totalScore: number | null;
}

/**
 * Build one immutable run record. The returned object (and its flags array) is
 * frozen so a built record cannot be mutated after the fact.
 */
export function buildRunRecord(input: RunRecordInput): RunRecord {
  const completed = input.status === "EVALUATED";
  const record: RunRecord = {
    submissionId: input.submissionId,
    teamId: input.teamId,
    repoUrl: input.repoUrl,
    commitSha: input.commitSha ?? null,
    evidenceFetchedAt: input.evidenceFetchedAt ?? null,
    rubricVersion: input.rubricVersion,
    promptVersion: input.promptVersion,
    model: input.model ?? null,
    modelConfig: input.modelConfig ?? null,
    status: input.status,
    finalScore: input.finalScore ?? null,
    totalScore: completed ? input.finalScore ?? null : null,
    confidence: input.confidence ?? null,
    flags: Object.freeze([...(input.flags ?? [])]) as string[],
    error: input.error ?? null,
    criterionScores: input.criterionScores ?? null,
    rawEvidence: input.rawEvidence ?? null,
    sanitizedEvidence: input.sanitizedEvidence ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
  return Object.freeze(record);
}

/** Append-only: returns a NEW array; never mutates the existing history. */
export function appendRun(history: readonly RunRecord[], run: RunRecord): RunRecord[] {
  return [...history, run];
}

export const evaluationId = (record: { id: string }) => record.id;

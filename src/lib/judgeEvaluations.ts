import { z } from "zod";
import { Prisma, type PrismaClient, type JudgeEvaluationStatus } from "@prisma/client";
import { JudgeServiceError, assertJudgingOpen, whileJudgingOpen } from "@/lib/judges";

/**
 * Manual judge evaluations: draft → submitted, scored against the existing rubric.
 *
 * Every function takes `judgeId` from the server session (requireJudge / the
 * judge layout) — never from the client — and re-checks that the team is still
 * assigned to that judge. Evaluations are always looked up by (id, judgeId), so
 * one judge can never read or change another judge's evaluation.
 *
 * `db` is injected so tests can use an in-memory fake (tests/judgeEvaluations.test.ts).
 */

export type JudgeEvalDb = Pick<PrismaClient, "judgeAssignment" | "judgeEvaluation" | "judgeCriterionScore" | "rubric" | "resultsPublication" | "$transaction" | "$queryRaw">;

/** What a judge may see about a team (blind judging: no name, university or members). */
const BLIND_TEAM_SELECT = { id: true, teamCode: true, projectTitle: true, projectDescription: true, repoUrl: true } as const;
export type BlindTeam = Prisma.TeamGetPayload<{ select: typeof BLIND_TEAM_SELECT }>;

export type EvaluationStatus = "NOT_STARTED" | JudgeEvaluationStatus;

export interface EvaluationCriterion {
  criterionId: string;
  criterionName: string;
  /** From the current rubric; null if the criterion has since been removed. */
  description: string | null;
  weight: number;
  scaleMax: number;
  score: number | null;
  /** The judge's remark on this criterion (optional). */
  comment: string | null;
}

export interface EvaluationView {
  id: string;
  teamId: string;
  status: JudgeEvaluationStatus;
  finalScore: number | null;
  submittedAt: Date | null;
  /** The judge's overall feedback (optional). */
  overallComment: string | null;
  criteria: EvaluationCriterion[];
}

type EvalWithScores = Prisma.JudgeEvaluationGetPayload<{ include: { scores: true } }>;

const SUBMITTED_MSG = "This evaluation has been submitted and can no longer be changed";

export const COMMENT_MAX = 2000;
export const OVERALL_COMMENT_MAX = 5000;

/** Remark text: trimmed; empty → null (clears it). Omitted → left unchanged. */
const remark = (max: number, label: string) =>
  z.string().max(max * 2).nullable().optional()
    .transform((v) => (v == null ? v : v.trim() || null))
    .refine((v) => v == null || v.length <= max, `${label} can be at most ${max} characters`);

export const draftInput = z
  .object({
    scores: z
      .array(z.object({
        criterionId: z.string().min(1),
        score: z.number().int("scores must be whole numbers").nullable(),
        comment: remark(COMMENT_MAX, "A criterion remark"),
      }).strict())
      .max(100),
    overallComment: remark(OVERALL_COMMENT_MAX, "Overall feedback"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------

/**
 * Σ (score / scaleMax) × weight / Σ weight × 100, rounded to 2 dp → 0..100.
 * Weights are relative: with weights totalling 100 this is the plain weighted sum;
 * with weight = max × multiplier it equals Σ score × multiplier scaled to 100.
 */
export function calculateJudgeFinalScore(scores: { score: number; scaleMax: number; weight: number }[]): number {
  const weightTotal = scores.reduce((sum, s) => sum + s.weight, 0);
  if (weightTotal <= 0) return 0;
  const total = scores.reduce((sum, s) => sum + (s.score / s.scaleMax) * s.weight, 0) / weightTotal * 100;
  return Math.round(total * 100) / 100;
}

/** Error message if `score` is not a whole number in 0..scaleMax, else null. */
export function scoreError(name: string, score: number, scaleMax: number): string | null {
  if (!Number.isInteger(score)) return `${name}: score must be a whole number`;
  if (score < 0 || score > scaleMax) return `${name}: score must be between 0 and ${scaleMax}`;
  return null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The team (blind fields) if assigned to this judge, else 404. */
export async function requireAssignedTeam(db: JudgeEvalDb, judgeId: string, teamId: string): Promise<BlindTeam> {
  const a = await db.judgeAssignment.findUnique({
    where: { judgeId_teamId: { judgeId, teamId } },
    select: { team: { select: BLIND_TEAM_SELECT } },
  });
  if (!a) throw new JudgeServiceError(404, "Team not found or not assigned to you");
  return a.team;
}

/** The judge's assigned teams with their own evaluation status for each. */
export async function listTeamsWithStatus(db: JudgeEvalDb, judgeId: string) {
  const [assignments, evaluations] = await Promise.all([
    db.judgeAssignment.findMany({
      where: { judgeId, team: { disqualifiedAt: null } },
      orderBy: { team: { teamCode: "asc" } },
      select: { team: { select: { id: true, teamCode: true, projectTitle: true } } },
    }),
    db.judgeEvaluation.findMany({ where: { judgeId }, select: { teamId: true, status: true } }),
  ]);
  const statusByTeam = new Map(evaluations.map((e) => [e.teamId, e.status]));
  return assignments.map(({ team }) => ({
    teamId: team.id,
    teamCode: team.teamCode,
    projectTitle: team.projectTitle,
    status: (statusByTeam.get(team.id) ?? "NOT_STARTED") as EvaluationStatus,
  }));
}

// ---------------------------------------------------------------------------
// Progress (pure; used by the judge dashboard and the organizer judges page)
// ---------------------------------------------------------------------------

export interface EvaluationProgress {
  assigned: number;
  submitted: number;
  draft: number;
  notStarted: number;
  /** submitted / assigned, whole percent (0 when nothing is assigned). */
  percent: number;
}

/** Counts for one judge's assigned-team statuses. */
export function summarizeProgress(statuses: EvaluationStatus[]): EvaluationProgress {
  const count = (s: EvaluationStatus) => statuses.filter((x) => x === s).length;
  const submitted = count("SUBMITTED");
  return {
    assigned: statuses.length,
    submitted,
    draft: count("DRAFT"),
    notStarted: count("NOT_STARTED"),
    percent: statuses.length ? Math.round((submitted / statuses.length) * 100) : 0,
  };
}

/**
 * Per judge: status of each ASSIGNED team (an evaluation of a team that is no
 * longer assigned is not part of the judge's workload) and the summary counts.
 */
export function progressByJudge(
  assignments: { judgeId: string; teamId: string }[],
  evaluations: { judgeId: string; teamId: string; status: JudgeEvaluationStatus }[],
): Map<string, { statusByTeam: Record<string, EvaluationStatus>; progress: EvaluationProgress }> {
  const evalStatus = new Map(evaluations.map((e) => [`${e.judgeId}:${e.teamId}`, e.status]));
  const byJudge = new Map<string, Record<string, EvaluationStatus>>();
  for (const a of assignments) {
    const statuses = byJudge.get(a.judgeId) ?? {};
    statuses[a.teamId] = evalStatus.get(`${a.judgeId}:${a.teamId}`) ?? "NOT_STARTED";
    byJudge.set(a.judgeId, statuses);
  }
  return new Map(
    [...byJudge].map(([judgeId, statusByTeam]) => [judgeId, { statusByTeam, progress: summarizeProgress(Object.values(statusByTeam)) }]),
  );
}

/** progressByJudge from the database (organizer only — spans every judge). */
export async function getJudgeProgress(db: Pick<PrismaClient, "judgeAssignment" | "judgeEvaluation">) {
  const [assignments, evaluations] = await Promise.all([
    db.judgeAssignment.findMany({ where: { team: { disqualifiedAt: null } }, select: { judgeId: true, teamId: true } }),
    db.judgeEvaluation.findMany({ select: { judgeId: true, teamId: true, status: true } }),
  ]);
  return progressByJudge(assignments, evaluations);
}

/** Existing evaluation for an assigned team, or null if not started. */
export async function getEvaluation(db: JudgeEvalDb, judgeId: string, teamId: string): Promise<EvaluationView | null> {
  await requireAssignedTeam(db, judgeId, teamId);
  const existing = await db.judgeEvaluation.findUnique({
    where: { judgeId_teamId: { judgeId, teamId } },
    include: { scores: true },
  });
  return existing ? toView(db, existing) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Load the judge's evaluation for an assigned team, creating it (one empty score
 * per current rubric criterion, with name/weight/scaleMax snapshots) if absent.
 */
export async function getOrStartEvaluation(db: JudgeEvalDb, judgeId: string, teamId: string): Promise<EvaluationView> {
  await requireAssignedTeam(db, judgeId, teamId);

  const existing = await db.judgeEvaluation.findUnique({
    where: { judgeId_teamId: { judgeId, teamId } },
    include: { scores: true },
  });
  if (existing && !(await isStaleEmptyDraft(db, existing))) return toView(db, existing);
  await assertJudgingOpen(db); // no new evaluations once judging is finalized

  const rubric = await db.rubric.findFirst({ include: { criteria: { orderBy: { order: "asc" } } } });
  if (!rubric || rubric.criteria.length === 0) {
    throw new JudgeServiceError(409, "The rubric has no criteria yet. Ask the organizer to set it up.");
  }

  // An untouched draft opened before the rubric changed: rebuild it on the current rubric.
  // Conditional on it still being this judge's DRAFT with nothing entered, so it can't wipe work.
  if (existing) {
    const empty = { evaluation: { is: { id: existing.id, judgeId, status: "DRAFT" as const } }, score: null, comment: null };
    await whileJudgingOpen(db, [
      db.judgeCriterionScore.deleteMany({ where: empty }),
      db.judgeCriterionScore.createMany({
        data: rubric.criteria.map((c) => ({ evaluationId: existing.id, criterionId: c.id, criterionName: c.name, weight: c.weight, scaleMax: c.scaleMax })),
        skipDuplicates: true,
      }),
    ]);
    const rebuilt = await db.judgeEvaluation.findUnique({ where: { judgeId_teamId: { judgeId, teamId } }, include: { scores: true } });
    return toView(db, rebuilt!);
  }

  try {
    const [created] = await whileJudgingOpen(db, [db.judgeEvaluation.create({
      data: {
        judgeId,
        teamId,
        scores: {
          create: rubric.criteria.map((c) => ({
            criterionId: c.id,
            criterionName: c.name,
            weight: c.weight,
            scaleMax: c.scaleMax,
          })),
        },
      },
      include: { scores: true },
    })]);
    return toView(db, created);
  } catch (e) {
    // Opened twice at once: the other request created it — load that one.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.judgeEvaluation.findUnique({
        where: { judgeId_teamId: { judgeId, teamId } },
        include: { scores: true },
      });
      if (again) return toView(db, again);
    }
    throw e;
  }
}

/**
 * Save some or all scores and remarks on the judge's own DRAFT. Null clears a score
 * or remark; an omitted remark is left unchanged.
 */
export async function saveDraft(db: JudgeEvalDb, judgeId: string, evaluationId: string, input: z.input<typeof draftInput>) {
  const { scores, overallComment } = draftInput.parse(input);
  const current = await loadOwn(db, judgeId, evaluationId);
  await assertJudgingOpen(db);

  const rowByCriterion = new Map(current.scores.map((s) => [s.criterionId, s]));
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const s of scores) {
    const row = rowByCriterion.get(s.criterionId);
    if (!row) { errors.push(`Unknown criterion "${s.criterionId}"`); continue; }
    if (seen.has(s.criterionId)) { errors.push(`${row.criterionName}: scored more than once`); continue; }
    seen.add(s.criterionId);
    const err = s.score === null ? null : scoreError(row.criterionName, s.score, row.scaleMax);
    if (err) errors.push(err);
  }
  if (errors.length) throw new JudgeServiceError(400, errors.join("; "));

  // One DB transaction, guarded against finalization (whileJudgingOpen). Every
  // write is conditional on the evaluation still being this judge's DRAFT, so a
  // save racing a submit writes nothing. Bumping updatedAt first also
  // invalidates any submit that read the old scores.
  const draft = { id: evaluationId, judgeId, status: "DRAFT" as const };
  const [bumped] = await whileJudgingOpen(db, [
    db.judgeEvaluation.updateMany({
      where: draft,
      data: { updatedAt: new Date(), ...(overallComment !== undefined ? { overallComment } : {}) },
    }),
    ...scores.map((s) =>
      db.judgeCriterionScore.updateMany({
        where: { id: rowByCriterion.get(s.criterionId)!.id, evaluation: { is: draft } },
        data: { score: s.score, ...(s.comment !== undefined ? { comment: s.comment } : {}) },
      }),
    ),
  ]);
  if (bumped.count === 0) throw new JudgeServiceError(409, SUBMITTED_MSG);
  return toView(db, await loadOwn(db, judgeId, evaluationId, { allowSubmitted: true }));
}

/** Submit the judge's own DRAFT. Every criterion must be scored. Irreversible. */
export async function submitEvaluation(db: JudgeEvalDb, judgeId: string, evaluationId: string) {
  const ev = await loadOwn(db, judgeId, evaluationId);
  await assertJudgingOpen(db);

  const missing = ev.scores.filter((s) => s.score === null).map((s) => s.criterionName);
  if (missing.length) throw new JudgeServiceError(400, `Score every criterion before submitting. Missing: ${missing.join(", ")}`);
  const finalScore = calculateJudgeFinalScore(ev.scores.map((s) => ({ score: s.score!, scaleMax: s.scaleMax, weight: s.weight })));

  // Only succeeds if judging is still open (whileJudgingOpen: serialized against
  // finalization), nothing changed since we read the scores (updatedAt), and it is still a draft.
  const [{ count }] = await whileJudgingOpen(db, [
    db.judgeEvaluation.updateMany({
      where: { id: evaluationId, judgeId, status: "DRAFT", updatedAt: ev.updatedAt },
      data: { status: "SUBMITTED", finalScore, submittedAt: new Date() },
    }),
  ]);
  if (count === 0) {
    const now = await loadOwn(db, judgeId, evaluationId, { allowSubmitted: true });
    throw new JudgeServiceError(409, now.status === "SUBMITTED" ? SUBMITTED_MSG : "Scores changed while submitting. Please try again.");
  }
  return toView(db, await loadOwn(db, judgeId, evaluationId, { allowSubmitted: true }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The judge's own evaluation (404 for anyone else's), for a team still assigned
 * to them. Rejects SUBMITTED with 409 unless `allowSubmitted`.
 */
async function loadOwn(db: JudgeEvalDb, judgeId: string, evaluationId: string, opts: { allowSubmitted?: boolean } = {}) {
  const ev = await db.judgeEvaluation.findFirst({ where: { id: evaluationId, judgeId }, include: { scores: true } });
  if (!ev) throw new JudgeServiceError(404, "Evaluation not found");
  await requireAssignedTeam(db, judgeId, ev.teamId);
  if (ev.status === "SUBMITTED" && !opts.allowSubmitted) throw new JudgeServiceError(409, SUBMITTED_MSG);
  return ev;
}

/**
 * True for a DRAFT built from an older rubric (its criteria no longer match the current
 * ones) on which the judge has entered nothing — no score, remark or overall feedback.
 */
async function isStaleEmptyDraft(db: JudgeEvalDb, ev: EvalWithScores): Promise<boolean> {
  if (ev.status !== "DRAFT" || ev.overallComment) return false;
  if (ev.scores.some((s) => s.score !== null || s.comment)) return false;
  const rubric = await db.rubric.findFirst({ select: { criteria: { select: { id: true } } } });
  const current = new Set((rubric?.criteria ?? []).map((c) => c.id));
  if (current.size === 0) return false;
  return ev.scores.length !== current.size || ev.scores.some((s) => !current.has(s.criterionId));
}

/** Scores in current rubric order, with the current criterion description when it still exists. */
async function toView(db: JudgeEvalDb, ev: EvalWithScores): Promise<EvaluationView> {
  const rubric = await db.rubric.findFirst({ include: { criteria: { orderBy: { order: "asc" } } } });
  const current = new Map((rubric?.criteria ?? []).map((c, i) => [c.id, { description: c.description, order: i }]));
  const criteria = [...ev.scores]
    .sort((a, b) => (current.get(a.criterionId)?.order ?? 1e9) - (current.get(b.criterionId)?.order ?? 1e9))
    .map((s) => ({
      criterionId: s.criterionId,
      criterionName: s.criterionName,
      description: current.get(s.criterionId)?.description ?? null,
      weight: s.weight,
      scaleMax: s.scaleMax,
      score: s.score,
      comment: s.comment ?? null,
    }));
  return {
    id: ev.id, teamId: ev.teamId, status: ev.status, finalScore: ev.finalScore, submittedAt: ev.submittedAt,
    overallComment: ev.overallComment ?? null, criteria,
  };
}

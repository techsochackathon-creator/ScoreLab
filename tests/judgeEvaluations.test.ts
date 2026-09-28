/**
 * Unit tests for manual judge evaluations (draft → submit).
 * In-memory stand-in for the Prisma calls the service makes — no real database.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  calculateJudgeFinalScore,
  getEvaluation,
  getOrStartEvaluation,
  listTeamsWithStatus,
  saveDraft,
  submitEvaluation,
  type JudgeEvalDb,
} from "../src/lib/judgeEvaluations";
import { JudgeServiceError } from "../src/lib/judges";

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------

interface MEval { id: string; judgeId: string; teamId: string; status: "DRAFT" | "SUBMITTED"; finalScore: number | null; submittedAt: Date | null; createdAt: Date; updatedAt: Date }
interface MScore { id: string; evaluationId: string; criterionId: string; criterionName: string; weight: number; scaleMax: number; score: number | null }

// Mirrors the seeded rubric shape: per-criterion scales, weights summing to 100.
const CRITERIA = [
  { id: "c1", name: "Problem & Innovation", description: "Originality", weight: 20, scaleMax: 20, order: 0 },
  { id: "c2", name: "AI Implementation", description: "Use of AI", weight: 25, scaleMax: 25, order: 1 },
  { id: "c3", name: "Functionality", description: "Works", weight: 20, scaleMax: 20, order: 2 },
  { id: "c4", name: "Impact", description: "Usefulness", weight: 15, scaleMax: 15, order: 3 },
  { id: "c5", name: "UX", description: "Usability", weight: 10, scaleMax: 10, order: 4 },
  { id: "c6", name: "Presentation", description: "Pitch", weight: 10, scaleMax: 10, order: 5 },
];

function makeDb() {
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;
  const teams = new Map([
    ["teamA", { id: "teamA", teamCode: "TEAM-001", projectTitle: "Alpha", projectDescription: null, repoUrl: null }],
    ["teamB", { id: "teamB", teamCode: "TEAM-002", projectTitle: null, projectDescription: null, repoUrl: null }],
  ]);
  const assignments: { judgeId: string; teamId: string }[] = [];
  const evals: MEval[] = [];
  const scores: MScore[] = [];
  type EvalWhere = { id: string; judgeId: string; status: string };
  const matchEval = (e: MEval, w: EvalWhere) => e.id === w.id && e.judgeId === w.judgeId && e.status === w.status;
  const withScores = (e: MEval) => ({ ...e, scores: scores.filter((s) => s.evaluationId === e.id).map((s) => ({ ...s })) });

  const db = {
    judgeAssignment: {
      findUnique: async ({ where }: { where: { judgeId_teamId: { judgeId: string; teamId: string } } }) => {
        const { judgeId, teamId } = where.judgeId_teamId;
        return assignments.some((a) => a.judgeId === judgeId && a.teamId === teamId) ? { team: teams.get(teamId)! } : null;
      },
      findMany: async ({ where }: { where: { judgeId: string } }) =>
        assignments.filter((a) => a.judgeId === where.judgeId).map((a) => ({ team: teams.get(a.teamId)! })),
    },
    judgeEvaluation: {
      findUnique: async ({ where }: { where: { judgeId_teamId: { judgeId: string; teamId: string } } }) => {
        const e = evals.find((x) => x.judgeId === where.judgeId_teamId.judgeId && x.teamId === where.judgeId_teamId.teamId);
        return e ? withScores(e) : null;
      },
      findFirst: async ({ where }: { where: { id: string; judgeId: string } }) => {
        const e = evals.find((x) => x.id === where.id && x.judgeId === where.judgeId);
        return e ? withScores(e) : null;
      },
      findMany: async ({ where }: { where: { judgeId: string } }) => evals.filter((e) => e.judgeId === where.judgeId).map((e) => ({ ...e })),
      create: async ({ data }: { data: { judgeId: string; teamId: string; scores: { create: Omit<MScore, "id" | "evaluationId" | "score">[] } } }) => {
        if (evals.some((e) => e.judgeId === data.judgeId && e.teamId === data.teamId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const e: MEval = { id: id("eval"), judgeId: data.judgeId, teamId: data.teamId, status: "DRAFT", finalScore: null, submittedAt: null, createdAt: new Date(), updatedAt: new Date() };
        evals.push(e);
        for (const s of data.scores.create) scores.push({ id: id("score"), evaluationId: e.id, score: null, ...s });
        return withScores(e);
      },
      updateMany: async ({ where, data }: { where: EvalWhere & { updatedAt?: Date }; data: Partial<MEval> }) => {
        const hits = evals.filter((e) => matchEval(e, where) && (!where.updatedAt || e.updatedAt.getTime() === where.updatedAt.getTime()));
        hits.forEach((e) => Object.assign(e, data, { updatedAt: data.updatedAt ?? new Date(e.updatedAt.getTime() + 1) }));
        return { count: hits.length };
      },
    },
    judgeCriterionScore: {
      updateMany: async ({ where, data }: { where: { id: string; evaluation: { is: EvalWhere } }; data: { score: number | null } }) => {
        const hits = scores.filter((s) => s.id === where.id && matchEval(evals.find((e) => e.id === s.evaluationId)!, where.evaluation.is));
        hits.forEach((s) => Object.assign(s, data));
        return { count: hits.length };
      },
    },
    rubric: {
      findFirst: async () => ({ id: "r1", name: "Rubric", criteria: CRITERIA }),
    },
    // Batch transactions: each op already ran in order when its promise was created.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return { db: db as unknown as JudgeEvalDb, assignments, evals, scores };
}

const FULL = [
  { criterionId: "c1", score: 16 },
  { criterionId: "c2", score: 20 },
  { criterionId: "c3", score: 15 },
  { criterionId: "c4", score: 12 },
  { criterionId: "c5", score: 8 },
  { criterionId: "c6", score: 5 },
];
// (16/20)*20 + (20/25)*25 + (15/20)*20 + (12/15)*15 + (8/10)*10 + (5/10)*10 = 16+20+15+12+8+5
const FULL_TOTAL = 76;

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof JudgeServiceError, `expected JudgeServiceError, got ${String(e)}`);
    assert.equal(e.status, status);
    return true;
  });
}

describe("judge evaluations", () => {
  let t: ReturnType<typeof makeDb>;
  beforeEach(() => {
    t = makeDb();
    t.assignments.push({ judgeId: "judgeA", teamId: "teamA" }, { judgeId: "judgeB", teamId: "teamA" }, { judgeId: "judgeB", teamId: "teamB" });
  });

  it("assigned judge can create an evaluation with rubric snapshots and empty scores", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    assert.equal(ev.status, "DRAFT");
    assert.equal(ev.criteria.length, CRITERIA.length);
    assert.deepEqual(ev.criteria[1], { criterionId: "c2", criterionName: "AI Implementation", description: "Use of AI", weight: 25, scaleMax: 25, score: null });
    // Opening again loads the same evaluation instead of creating another.
    const again = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    assert.equal(again.id, ev.id);
    assert.equal(t.evals.length, 1);
  });

  it("unassigned judge cannot evaluate a team", async () => {
    await rejects(getOrStartEvaluation(t.db, "judgeA", "teamB"), 404);
    await rejects(getEvaluation(t.db, "judgeA", "teamB"), 404);
    assert.equal(t.evals.length, 0);
  });

  it("judge can save a partial draft, repeatedly, and clear a score", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    let saved = await saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 10 }] });
    assert.equal(saved.criteria.find((c) => c.criterionId === "c1")!.score, 10);
    saved = await saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: null }, { criterionId: "c2", score: 25 }] });
    assert.equal(saved.criteria.find((c) => c.criterionId === "c1")!.score, null);
    assert.equal(saved.criteria.find((c) => c.criterionId === "c2")!.score, 25);
    assert.equal(saved.status, "DRAFT");
    assert.equal(saved.finalScore, null);
  });

  it("invalid scores are rejected and nothing is written", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c5", score: 11 }] }), 400); // above scaleMax 10
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 5 }, { criterionId: "c5", score: -1 }] }), 400);
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "nope", score: 1 }] }), 400);
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 1 }, { criterionId: "c1", score: 2 }] }), 400);
    await assert.rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 2.5 }] })); // not an integer
    assert.ok(t.scores.every((s) => s.score === null));
  });

  it("scores use each criterion's own scale (max 25 allowed on a 25-point criterion)", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    const saved = await saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c2", score: 25 }, { criterionId: "c1", score: 0 }] });
    assert.equal(saved.criteria.find((c) => c.criterionId === "c2")!.score, 25);
  });

  it("incomplete evaluation cannot be submitted", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    await saveDraft(t.db, "judgeA", ev.id, { scores: FULL.slice(0, 5) });
    await rejects(submitEvaluation(t.db, "judgeA", ev.id), 400);
    assert.equal(t.evals[0].status, "DRAFT");
  });

  it("completed evaluation can be submitted with the correct final score", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    await saveDraft(t.db, "judgeA", ev.id, { scores: FULL });
    const done = await submitEvaluation(t.db, "judgeA", ev.id);
    assert.equal(done.status, "SUBMITTED");
    assert.equal(done.finalScore, FULL_TOTAL);
    assert.ok(done.submittedAt instanceof Date);
  });

  it("final score formula: Σ (score / scaleMax) × weight, out of 100", () => {
    assert.equal(calculateJudgeFinalScore(CRITERIA.map((c) => ({ score: c.scaleMax, scaleMax: c.scaleMax, weight: c.weight }))), 100);
    assert.equal(calculateJudgeFinalScore(CRITERIA.map((c) => ({ score: 0, scaleMax: c.scaleMax, weight: c.weight }))), 0);
    assert.equal(calculateJudgeFinalScore([{ score: 7, scaleMax: 25, weight: 25 }, { score: 1, scaleMax: 3, weight: 75 }]), 32);
    assert.equal(calculateJudgeFinalScore([{ score: 1, scaleMax: 3, weight: 100 }]), 33.33);
  });

  it("submitted evaluation cannot be edited or submitted again", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    await saveDraft(t.db, "judgeA", ev.id, { scores: FULL });
    await submitEvaluation(t.db, "judgeA", ev.id);
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 1 }] }), 409);
    await rejects(submitEvaluation(t.db, "judgeA", ev.id), 409);
    assert.equal(t.scores.find((s) => s.criterionId === "c1" && s.evaluationId === ev.id)!.score, 16);
    // Reopening the team shows the submitted, read-only evaluation.
    assert.equal((await getOrStartEvaluation(t.db, "judgeA", "teamA")).status, "SUBMITTED");
  });

  it("Judge A cannot access Judge B's evaluation", async () => {
    const evB = await getOrStartEvaluation(t.db, "judgeB", "teamB");
    await rejects(saveDraft(t.db, "judgeA", evB.id, { scores: [{ criterionId: "c1", score: 1 }] }), 404);
    await rejects(submitEvaluation(t.db, "judgeA", evB.id), 404);
    await rejects(getEvaluation(t.db, "judgeA", "teamB"), 404);
    assert.deepEqual((await listTeamsWithStatus(t.db, "judgeA")).map((x) => x.teamCode), ["TEAM-001"]);
  });

  it("losing the assignment blocks further edits", async () => {
    const ev = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    t.assignments.splice(t.assignments.findIndex((a) => a.judgeId === "judgeA"), 1);
    await rejects(saveDraft(t.db, "judgeA", ev.id, { scores: [{ criterionId: "c1", score: 1 }] }), 404);
  });

  it("multiple judges evaluate the same team independently", async () => {
    const evA = await getOrStartEvaluation(t.db, "judgeA", "teamA");
    const evB = await getOrStartEvaluation(t.db, "judgeB", "teamA");
    assert.notEqual(evA.id, evB.id);

    await saveDraft(t.db, "judgeA", evA.id, { scores: FULL });
    await submitEvaluation(t.db, "judgeA", evA.id);
    await saveDraft(t.db, "judgeB", evB.id, { scores: FULL.map((s) => ({ ...s, score: 0 })) });

    const a = await getEvaluation(t.db, "judgeA", "teamA");
    const b = await getEvaluation(t.db, "judgeB", "teamA");
    assert.equal(a!.status, "SUBMITTED");
    assert.equal(a!.finalScore, FULL_TOTAL);
    assert.equal(b!.status, "DRAFT");
    assert.ok(b!.criteria.every((c) => c.score === 0));

    const statuses = await listTeamsWithStatus(t.db, "judgeB");
    assert.deepEqual(statuses.map((s) => [s.teamCode, s.status]), [["TEAM-001", "DRAFT"], ["TEAM-002", "NOT_STARTED"]]);
  });
});

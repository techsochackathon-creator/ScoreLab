/**
 * Unit tests for official results (judge score only): finalization, the frozen
 * snapshot, publication, the public projection, locks and access rules.
 * Uses an in-memory DB fake whose AI tables throw if touched.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildJudgeResults, type ResultsInput } from "../src/lib/judgeResults";
import {
  finalizationBlockers,
  finalizeResults,
  getOfficialState,
  getPublicResults,
  officialStatus,
  publishResults,
  toPublicResults,
  unpublishResults,
  type OfficialResultsDb,
} from "../src/lib/officialResults";
import { assertRubricEditable, JudgeServiceError } from "../src/lib/judges";
import { areaRedirect, checkRole } from "../src/lib/roles";

const team = (id: string) => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: `Project ${id}` });
const sub = (teamId: string, judgeId: string, finalScore: number) => ({ teamId, judgeId, status: "SUBMITTED", finalScore });
const draft = (teamId: string, judgeId: string) => ({ teamId, judgeId, status: "DRAFT", finalScore: null });
const build = (teams: string[], evaluations: ResultsInput["evaluations"]) =>
  buildJudgeResults({ teams: teams.map(team), evaluations, assignments: [] });

type Row = { finalizedById: string; finalizedAt: Date; snapshot: unknown; publishedAt: Date | null; publishedById: string | null };

/**
 * DB fake. AI tables throw if touched; teams carry an AI total that would
 * reverse the ranking if it were ever used.
 */
function makeDb(evaluations: ResultsInput["evaluations"], teams = ["a", "b", "c"]) {
  let row: Row | null = null;
  /** Order of DB calls, to check finalization locks first and works inside its transaction. */
  const log: string[] = [];
  let inTx = false;
  const note = (what: string) => log.push(inTx ? `tx:${what}` : what);
  const forbidden = (name: string) => new Proxy({}, { get: () => { throw new Error(`official results must not read ${name}`); } });
  const db = {
    team: { findMany: async () => note("read teams") && teams.map((id, i) => ({ ...team(id), aiTotalScore: 100 - i * 40 })) },
    judgeEvaluation: {
      findMany: async () => note("read evaluations") && evaluations.map((e) => ({ ...e })),
      count: async ({ where }: { where: { status: string } }) => evaluations.filter((e) => e.status === where.status).length,
    },
    judgeAssignment: { findMany: async () => [] },
    resultsPublication: {
      findFirst: async () => (row ? structuredClone(row) : null),
      create: async ({ data }: { data: { finalizedById: string; snapshot: unknown } }) => {
        note("insert snapshot");
        if (row) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        row = { finalizedById: data.finalizedById, finalizedAt: new Date(), snapshot: structuredClone(data.snapshot), publishedAt: null, publishedById: null };
        return row;
      },
      updateMany: async ({ where, data }: { where: { publishedAt?: null }; data: Partial<Row> }) => {
        if (!row || (where.publishedAt === null && row.publishedAt !== null)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      note(strings.join("?").includes("pg_advisory_xact_lock(") ? "lock exclusive" : "raw");
      return [{ ok: 1 }];
    },
    // Interactive transaction: the callback's writes are discarded if it throws.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, opts?: { timeout?: number }) => {
      assert.ok((opts?.timeout ?? 0) >= 10_000, "finalization should allow a generous timeout");
      const saved = row;
      inTx = true;
      try {
        return await fn(db);
      } catch (e) {
        row = saved;
        throw e;
      } finally {
        inTx = false;
      }
    },
    submission: forbidden("Submission (AI)"),
    criterionScore: forbidden("CriterionScore (AI)"),
    evaluationEvent: forbidden("EvaluationEvent (AI)"),
    evalRun: forbidden("EvalRun (AI)"),
  };
  return { db: db as unknown as OfficialResultsDb, evaluations, log };
}

async function rejects(p: Promise<unknown>, status: number, match?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof JudgeServiceError, `expected JudgeServiceError, got ${String(e)}`);
    assert.equal(e.status, status);
    if (match) assert.match(e.message, match);
    return true;
  });
}

const COMPLETE = () => [sub("a", "j1", 91.5), sub("b", "j1", 87.25), sub("c", "j1", 81), sub("c", "j2", 81)];

// ---------------------------------------------------------------------------
// Live ranking & status (Phase 5 behaviour, still used while judging is open)
// ---------------------------------------------------------------------------

describe("live official ranking", () => {
  it("ranks by judge score; unevaluated teams have no rank", () => {
    const r = build(["a", "b", "c"], [sub("b", "j1", 87.5), sub("a", "j1", 91.25), draft("c", "j1")]);
    assert.deepEqual(r.ranked.map((t) => [t.rank, t.teamId]), [[1, "a"], [2, "b"]]);
    assert.deepEqual(["a", "b", "c"].map((id) => officialStatus(r, id)), ["WINNER", "RANKED", "NOT_EVALUATED"]);
  });

  it("equal highest scores → TIED_FIRST, no winner", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 71.5), sub("b", "j1", 71.5), sub("c", "j1", 68)]);
    assert.deepEqual(["a", "b", "c"].map((id) => officialStatus(r, id)), ["TIED_FIRST", "TIED_FIRST", "RANKED"]);
  });
});

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

describe("finalization", () => {
  it("succeeds with complete judging and a unique highest score", async () => {
    const { db } = makeDb(COMPLETE());
    const state = await finalizeResults(db, "org1");
    assert.equal(state.finalizedById, "org1");
    assert.ok(state.finalizedAt instanceof Date);
    assert.equal(state.publishedAt, null);
  });

  it("is atomic: takes the exclusive lock first, then reads and inserts inside one transaction", async () => {
    const t = makeDb(COMPLETE());
    await finalizeResults(t.db, "org1");
    const inside = t.log.filter((l) => l.startsWith("tx:"));
    assert.equal(inside[0], "tx:lock exclusive", "lock before any read");
    assert.ok(inside.includes("tx:read evaluations") && inside.includes("tx:read teams"), "results read inside the transaction");
    assert.equal(inside[inside.length - 1], "tx:insert snapshot", "snapshot inserted last, inside the transaction");
    assert.ok(!t.log.includes("insert snapshot"), "never inserted outside the transaction");
  });

  it("fails when a team has no submitted evaluation", async () => {
    const { db } = makeDb([sub("a", "j1", 90), sub("b", "j1", 80)]);
    await rejects(finalizeResults(db, "org1"), 400, /Cannot finalize: C has no submitted evaluation\./);
    assert.equal(await getOfficialState(db), null);
  });

  it("ignores drafts: drafts-only blocks, drafts beside a submission don't count", async () => {
    const blocked = makeDb([sub("a", "j1", 90), sub("b", "j1", 80), draft("c", "j1")]);
    await rejects(finalizeResults(blocked.db, "org1"), 400, /C has only draft evaluations/);

    const ok = makeDb([sub("a", "j1", 90), draft("a", "j2"), sub("b", "j1", 80), sub("c", "j1", 70), draft("c", "j2")]);
    const state = await finalizeResults(ok.db, "org1");
    assert.deepEqual(state.snapshot.teams.map((t) => t.judgeScore), [90, 80, 70]);
  });

  it("fails on a tie for the highest score, naming the teams and score", async () => {
    const { db } = makeDb([sub("a", "j1", 91.5), sub("b", "j1", 91.5), sub("c", "j1", 70)]);
    await rejects(finalizeResults(db, "org1"), 400, /Cannot finalize: A and B are tied at 91\.50\./);
    assert.equal(await getOfficialState(db), null);
  });

  it("reports every blocker at once", () => {
    const r = build(["a", "b", "c", "d"], [sub("a", "j1", 90), sub("b", "j1", 90), draft("c", "j1")]);
    assert.deepEqual(finalizationBlockers(r), [
      "Cannot finalize: D has no submitted evaluation.",
      "Cannot finalize: C has only draft evaluations.",
      "Cannot finalize: A and B are tied at 90.00.",
    ]);
  });

  it("unique highest score becomes the only winner", async () => {
    const { db } = makeDb(COMPLETE());
    const { snapshot } = await finalizeResults(db, "org1");
    assert.equal(snapshot.winnerTeamId, "a");
    assert.deepEqual(snapshot.teams.filter((t) => t.isWinner).map((t) => t.teamCode), ["A"]);
  });

  it("snapshot holds correct ranks and scores (lower ties share a rank)", async () => {
    const { db } = makeDb([sub("a", "j1", 91.5), sub("b", "j1", 80), sub("c", "j1", 80)]);
    const { snapshot } = await finalizeResults(db, "org1");
    assert.deepEqual(snapshot.teams, [
      { teamId: "a", teamCode: "A", teamName: "Team a", judgeScore: 91.5, rank: 1, isWinner: true },
      { teamId: "b", teamCode: "B", teamName: "Team b", judgeScore: 80, rank: 2, isWinner: false },
      { teamId: "c", teamCode: "C", teamName: "Team c", judgeScore: 80, rank: 2, isWinner: false },
    ]);
    assert.equal(snapshot.version, 1);
  });

  it("AI scores have no effect (AI tables are never read; AI totals would reverse the order)", async () => {
    const { db } = makeDb([sub("a", "j1", 60), sub("b", "j1", 70), sub("c", "j1", 80)]);
    const { snapshot } = await finalizeResults(db, "org1");
    assert.deepEqual(snapshot.teams.map((t) => t.teamCode), ["C", "B", "A"]);
  });
});

// ---------------------------------------------------------------------------
// Immutability, publication, public projection
// ---------------------------------------------------------------------------

describe("after finalization", () => {
  let t: ReturnType<typeof makeDb>;
  beforeEach(async () => {
    t = makeDb(COMPLETE());
    await finalizeResults(t.db, "org1");
  });

  it("the snapshot does not change when live judge data changes", async () => {
    const before = (await getOfficialState(t.db))!.snapshot;
    t.evaluations.push(sub("b", "j9", 100), sub("b", "j8", 100)); // would make B the winner live
    const after = (await getOfficialState(t.db))!.snapshot;
    assert.deepEqual(after, before);
    assert.equal(after.winnerTeamId, "a");
  });

  it("organizer cannot finalize again or alter the result; publish/unpublish leave the snapshot intact", async () => {
    const before = (await getOfficialState(t.db))!;
    await rejects(finalizeResults(t.db, "org2"), 409, /finalized/);
    await publishResults(t.db, "org2");
    await unpublishResults(t.db);
    await publishResults(t.db, "org2");
    const after = (await getOfficialState(t.db))!;
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.equal(after.finalizedById, "org1");
    assert.equal(after.finalizedAt.getTime(), before.finalizedAt.getTime());
  });

  it("public leaderboard is hidden until published, then shows the snapshot — not live data", async () => {
    assert.deepEqual(await getPublicResults(t.db), { published: false });
    await publishResults(t.db, "org1");
    t.evaluations.push(sub("c", "j9", 100), sub("c", "j8", 100)); // live data drifts
    const pub = await getPublicResults(t.db);
    assert.ok(pub.published);
    assert.deepEqual(pub.rows.map((r) => [r.rank, r.teamCode, r.judgeScore, r.status]), [
      [1, "A", 91.5, "WINNER"],
      [2, "B", 87.25, "RANKED"],
      [3, "C", 81, "RANKED"],
    ]);
    assert.deepEqual(pub.winner, { teamCode: "A", teamName: "Team a", judgeScore: 91.5 });
  });

  it("public projection exposes no judge data, internal ids or AI data", async () => {
    const json = JSON.stringify(toPublicResults((await getOfficialState(t.db))!.snapshot));
    for (const leak of ["j1", "j2", "judgeId", "teamId", "submittedJudges", "draft", "projectTitle", "aiTotal", "finalScore"]) {
      assert.ok(!json.includes(leak), `public results must not contain "${leak}"`);
    }
  });
});

describe("publication before finalization", () => {
  it("is rejected and nothing becomes public", async () => {
    const { db } = makeDb(COMPLETE());
    await rejects(publishResults(db, "org1"), 409, /Cannot publish results before judging has been finalized\./);
    assert.deepEqual(await getPublicResults(db), { published: false });
  });
});

// ---------------------------------------------------------------------------
// Rubric lock & access
// ---------------------------------------------------------------------------

describe("rubric lock", () => {
  it("editable with no submitted evaluations (drafts only); locked after the first submission", async () => {
    await assertRubricEditable(makeDb([draft("a", "j1")]).db);
    await rejects(assertRubricEditable(makeDb([draft("a", "j1"), sub("b", "j1", 50)]).db), 409, /The rubric is locked because judging has already started\./);
  });
});

describe("access", () => {
  // /api/organizer/results, /finalize and /publish all use requireOrganizer, which applies this check.
  it("judges and signed-out users cannot use finalization/publication APIs", () => {
    assert.deepEqual(checkRole({ role: "ORGANIZER" }, "ORGANIZER"), { ok: true });
    assert.deepEqual(checkRole({ role: "JUDGE" }, "ORGANIZER"), { ok: false, status: 403 });
    assert.deepEqual(checkRole(null, "ORGANIZER"), { ok: false, status: 401 });
  });

  it("judges are redirected away from the organizer results page; /leaderboard stays public", () => {
    assert.equal(areaRedirect("/organizer/results", "JUDGE"), "/judge");
    assert.equal(areaRedirect("/leaderboard", undefined), null);
  });
});

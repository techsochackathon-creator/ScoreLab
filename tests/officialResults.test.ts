/**
 * Unit tests for official results (judge score only): ranking, winner, ties,
 * the public projection, publication, and access rules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJudgeResults, type ResultsInput } from "../src/lib/judgeResults";
import {
  getPublicResults,
  officialStatus,
  publishResults,
  toPublicResults,
  unpublishResults,
  type OfficialResultsDb,
} from "../src/lib/officialResults";
import { JudgeServiceError } from "../src/lib/judges";
import { areaRedirect, checkRole } from "../src/lib/roles";

const team = (id: string) => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: `Project ${id}` });
const sub = (teamId: string, judgeId: string, finalScore: number) => ({ teamId, judgeId, status: "SUBMITTED", finalScore });
const draft = (teamId: string, judgeId: string) => ({ teamId, judgeId, status: "DRAFT", finalScore: null });
const build = (teams: string[], evaluations: ResultsInput["evaluations"]) =>
  buildJudgeResults({ teams: teams.map(team), evaluations, assignments: [{ teamId: teams[0], judgeId: "j1" }] });

/**
 * DB fake whose AI tables throw if touched — proves official results never read them.
 * Teams also carry an AI totalScore that would reverse the ranking if it were used.
 */
function makeDb(evaluations: ResultsInput["evaluations"], teams = ["a", "b", "c"]) {
  let publication: { publishedAt: Date } | null = null;
  const forbidden = (name: string) =>
    new Proxy({}, { get: () => { throw new Error(`official results must not read ${name}`); } });
  const db = {
    team: { findMany: async () => teams.map((id, i) => ({ ...team(id), aiTotalScore: 100 - i * 40 })) },
    judgeEvaluation: { findMany: async () => evaluations },
    judgeAssignment: { findMany: async () => [] },
    resultsPublication: {
      findFirst: async () => publication,
      upsert: async () => (publication ??= { publishedAt: new Date() }),
      deleteMany: async () => { const count = publication ? 1 : 0; publication = null; return { count }; },
    },
    submission: forbidden("Submission (AI)"),
    criterionScore: forbidden("CriterionScore (AI)"),
    evaluationEvent: forbidden("EvaluationEvent (AI)"),
    evalRun: forbidden("EvalRun (AI)"),
  };
  return db as unknown as OfficialResultsDb;
}

describe("official ranking", () => {
  it("ranks by judge score, highest first", () => {
    const r = build(["a", "b", "c"], [sub("b", "j1", 87.5), sub("c", "j1", 81.75), sub("a", "j1", 91.25)]);
    assert.deepEqual(r.ranked.map((t) => [t.rank, t.teamId, t.judgeScore]), [[1, "a", 91.25], [2, "b", 87.5], [3, "c", 81.75]]);
  });

  it("drafts never affect ranking", () => {
    const r = build(["a", "b"], [sub("a", "j1", 70), sub("b", "j1", 60), draft("b", "j2")]);
    assert.deepEqual(r.ranked.map((t) => t.teamId), ["a", "b"]);
    assert.equal(r.ranked[1].judgeScore, 60);
  });

  it("unevaluated teams have no rank and status NOT_EVALUATED", () => {
    const r = build(["a", "b"], [sub("a", "j1", 70), draft("b", "j1")]);
    assert.equal(officialStatus(r, "b"), "NOT_EVALUATED");
    assert.deepEqual(toPublicResults(r).notEvaluated, [{ teamCode: "B", teamName: "Team b" }]);
    assert.ok(!toPublicResults(r).rows.some((row) => row.teamCode === "B"));
  });

  it("AI scores do not affect the official ranking", async () => {
    // AI totals would rank a > b > c; judges rank c > b > a.
    const db = makeDb([sub("a", "j1", 60), sub("b", "j1", 70), sub("c", "j1", 80)]);
    await publishResults(db, "org1");
    const pub = await getPublicResults(db);
    assert.ok(pub.published);
    assert.deepEqual(pub.rows.map((r) => r.teamCode), ["C", "B", "A"]);
    assert.equal(pub.winner?.teamCode, "C");
  });
});

describe("winner and ties", () => {
  it("unique highest score → exactly one winner", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 92.5), sub("b", "j1", 80), sub("c", "j1", 70)]);
    const statuses = ["a", "b", "c"].map((id) => officialStatus(r, id));
    assert.deepEqual(statuses, ["WINNER", "RANKED", "RANKED"]);
    assert.equal(statuses.filter((s) => s === "WINNER").length, 1);
    assert.deepEqual(toPublicResults(r).winner, { teamCode: "A", teamName: "Team a", judgeScore: 92.5 });
  });

  it("equal highest scores → no winner, teams TIED_FIRST, public winner withheld", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 71.5), sub("b", "j1", 71.5), sub("c", "j1", 68)]);
    assert.deepEqual(["a", "b", "c"].map((id) => officialStatus(r, id)), ["TIED_FIRST", "TIED_FIRST", "RANKED"]);
    const pub = toPublicResults(r);
    assert.equal(pub.status, "TIE");
    assert.equal(pub.winner, null);
    assert.deepEqual(pub.tiedForFirst.map((t) => t.teamCode), ["A", "B"]);
    assert.ok(!pub.rows.some((row) => row.status === "WINNER"));
  });

  it("a lower-score tie does not stop the highest team from winning", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 80)]);
    assert.deepEqual(["a", "b", "c"].map((id) => officialStatus(r, id)), ["WINNER", "RANKED", "RANKED"]);
    assert.deepEqual(toPublicResults(r).rows.map((row) => row.rank), [1, 2, 2]);
  });

  it("number of judges is not a tie-breaker", () => {
    const r = build(["a", "b"], [sub("a", "j1", 80), sub("a", "j2", 80), sub("a", "j3", 80), sub("b", "j1", 80)]);
    assert.equal(r.status, "TIE");
    assert.equal(r.winnerTeamId, null);
  });
});

describe("public results", () => {
  it("expose no judge ids, judge counts, drafts, assignments, internal ids or AI data", () => {
    const r = build(["a", "b"], [sub("a", "secret-judge-1", 90), sub("a", "secret-judge-2", 80), draft("b", "secret-judge-3")]);
    const json = JSON.stringify(toPublicResults(r));
    for (const leak of ["secret-judge", "submittedJudges", "draftJudges", "assignedJudges", "judgeId", "teamId", "projectTitle", "ai", "finalScore"]) {
      assert.ok(!json.includes(leak), `public results must not contain "${leak}"`);
    }
    const row = toPublicResults(r).rows[0];
    assert.deepEqual(Object.keys(row).sort(), ["judgeScore", "rank", "status", "teamCode", "teamName"]);
  });

  it("hidden until an organizer publishes; unpublish hides again", async () => {
    const db = makeDb([sub("a", "j1", 70)]);
    assert.deepEqual(await getPublicResults(db), { published: false });
    await publishResults(db, "org1");
    assert.equal((await getPublicResults(db)).published, true);
    await unpublishResults(db);
    assert.deepEqual(await getPublicResults(db), { published: false });
  });

  it("cannot publish before any evaluation is submitted", async () => {
    const db = makeDb([draft("a", "j1")]);
    await assert.rejects(publishResults(db, "org1"), (e: unknown) => e instanceof JudgeServiceError && e.status === 409);
    assert.deepEqual(await getPublicResults(db), { published: false });
  });
});

describe("access", () => {
  // /api/organizer/results(/publish) use requireOrganizer, which applies this check.
  it("organizer-only results: organizer allowed, judge 403, signed-out 401", () => {
    assert.deepEqual(checkRole({ role: "ORGANIZER" }, "ORGANIZER"), { ok: true });
    assert.deepEqual(checkRole({ role: "JUDGE" }, "ORGANIZER"), { ok: false, status: 403 });
    assert.deepEqual(checkRole(null, "ORGANIZER"), { ok: false, status: 401 });
  });

  it("judges are redirected away from the organizer results page; /leaderboard is public", () => {
    assert.equal(areaRedirect("/organizer/results", "JUDGE"), "/judge");
    assert.equal(areaRedirect("/organizer/results", undefined), "/login?error=forbidden");
    assert.equal(areaRedirect("/leaderboard", undefined), null);
  });
});

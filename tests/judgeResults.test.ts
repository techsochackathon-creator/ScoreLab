/**
 * Unit tests for official judge results: averaging, rounding, incomplete teams,
 * ties, and the automatic winner (unique highest judge score).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJudgeResults, getJudgeResults, officialJudgeScore, type JudgeResultsDb, type ResultsInput } from "../src/lib/judgeResults";
import { checkRole } from "../src/lib/roles";

const team = (id: string) => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: null });
const sub = (teamId: string, judgeId: string, finalScore: number) => ({ teamId, judgeId, status: "SUBMITTED", finalScore });
const draft = (teamId: string, judgeId: string) => ({ teamId, judgeId, status: "DRAFT", finalScore: null });
const build = (teams: string[], evaluations: ResultsInput["evaluations"]) =>
  buildJudgeResults({ teams: teams.map(team), evaluations, assignments: [] });
const scoreOf = (r: ReturnType<typeof build>, id: string) => [...r.ranked, ...r.incomplete].find((t) => t.teamId === id)!;

describe("official judge score", () => {
  it("1 judge → that judge's score", () => {
    assert.equal(officialJudgeScore([85]), 85);
  });

  it("2 judges → arithmetic mean", () => {
    assert.equal(officialJudgeScore([85, 75]), 80);
  });

  it("3 judges → arithmetic mean, 2 dp", () => {
    assert.equal(officialJudgeScore([85, 75, 90]), 83.33);
    assert.equal(officialJudgeScore([82, 78, 80]), 80);
  });

  it("rounds half-up to 2 dp consistently", () => {
    assert.equal(officialJudgeScore([87.5, 87.51]), 87.51); // mean 87.505 → 87.51
    assert.equal(officialJudgeScore([87.51, 87.5, 87.5]), 87.5); // mean 87.5033 → 87.50
    assert.equal(officialJudgeScore([0.01, 0.02]), 0.02); // 0.015 → 0.02
    assert.equal(officialJudgeScore([33.33, 33.34, 33.34]), 33.34); // 33.3366… → 33.34
    assert.equal(officialJudgeScore([]), null);
  });

  it("drafts are ignored and a judge counts once", () => {
    const r = build(["a"], [sub("a", "j1", 80), draft("a", "j2"), sub("a", "j1", 10)]);
    const a = scoreOf(r, "a");
    assert.equal(a.judgeScore, 80);
    assert.equal(a.submittedJudges, 1);
    assert.equal(a.draftJudges, 1);
  });

  it("team with no submitted evaluations has no score, is not ranked, cannot win", () => {
    const r = build(["a", "b"], [sub("a", "j1", 70), draft("b", "j1")]);
    assert.deepEqual(r.ranked.map((t) => t.teamId), ["a"]);
    assert.deepEqual(r.incomplete.map((t) => t.teamId), ["b"]);
    assert.equal(scoreOf(r, "b").judgeScore, null);
    assert.equal(scoreOf(r, "b").rank, null);
    assert.equal(r.winnerTeamId, "a");
  });

  it("multiple judges on the same team are averaged independently of other teams", () => {
    const r = build(["a", "b"], [sub("a", "j1", 90), sub("a", "j2", 70), sub("a", "j3", 80), sub("b", "j1", 60), sub("b", "j2", 100)]);
    assert.equal(scoreOf(r, "a").judgeScore, 80);
    assert.equal(scoreOf(r, "a").submittedJudges, 3);
    assert.equal(scoreOf(r, "b").judgeScore, 80);
  });
});

describe("winner", () => {
  it("unique highest score is the winner automatically", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 82.5), sub("b", "j1", 78), sub("c", "j1", 71.5)]);
    assert.equal(r.status, "WINNER");
    assert.equal(r.winnerTeamId, "a");
    assert.deepEqual(r.topTeamIds, ["a"]);
    assert.deepEqual(r.ties, []);
  });

  it("winner is decided by the averaged official score, not by any single judge", () => {
    // b has the single highest judge score (95) but a has the higher average.
    const r = build(["a", "b"], [sub("a", "j1", 85), sub("a", "j2", 85), sub("b", "j1", 95), sub("b", "j2", 70)]);
    assert.equal(r.winnerTeamId, "a");
  });

  it("no submissions → no results, no winner", () => {
    const r = build(["a", "b"], [draft("a", "j1")]);
    assert.equal(r.status, "NO_RESULTS");
    assert.equal(r.winnerTeamId, null);
  });
});

describe("ties", () => {
  it("shared highest score → TIE, no winner; lower teams are not part of the tie", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 71.5), sub("b", "j1", 71.5), sub("c", "j1", 68)]);
    assert.equal(r.status, "TIE");
    assert.equal(r.winnerTeamId, null);
    assert.deepEqual(r.topTeamIds, ["a", "b"]);
    assert.deepEqual(r.ties, [{ rank: 1, judgeScore: 71.5, teamIds: ["a", "b"] }]);
    assert.deepEqual(scoreOf(r, "c").tiedWith, []);
    assert.equal(scoreOf(r, "c").rank, 3);
  });

  it("ties use the rounded 2-dp value, not raw floats", () => {
    // a: (87.5 + 87.51) / 2 = 87.505 → 87.51 ; b: 87.51 → tie
    const tied = build(["a", "b"], [sub("a", "j1", 87.5), sub("a", "j2", 87.51), sub("b", "j1", 87.51)]);
    assert.equal(tied.status, "TIE");
    // a: 87.5033 → 87.50 ; b: 87.51 → b wins
    const clear = build(["a", "b"], [sub("a", "j1", 87.51), sub("a", "j2", 87.5), sub("a", "j3", 87.5), sub("b", "j1", 87.51)]);
    assert.equal(clear.status, "WINNER");
    assert.equal(clear.winnerTeamId, "b");
  });

  it("a tie below first place does not affect the winner", () => {
    const r = build(["a", "b", "c"], [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 80)]);
    assert.deepEqual(r.ranked.map((t) => [t.teamId, t.rank]), [["a", 1], ["b", 2], ["c", 2]]);
    assert.equal(r.status, "WINNER");
    assert.equal(r.winnerTeamId, "a");
    assert.deepEqual(r.ties, [{ rank: 2, judgeScore: 80, teamIds: ["b", "c"] }]);
  });

  it("team code / order never breaks a tie", () => {
    const forward = build(["a", "b"], [sub("a", "j1", 90), sub("b", "j1", 90)]);
    const reversed = build(["b", "a"], [sub("b", "j1", 90), sub("a", "j1", 90)]);
    assert.equal(forward.winnerTeamId, null);
    assert.equal(reversed.winnerTeamId, null);
  });
});

describe("data source and access", () => {
  it("results are computed only from database rows", async () => {
    const db = {
      team: { findMany: async () => [team("a"), team("b")] },
      judgeEvaluation: { findMany: async () => [sub("a", "j1", 60), sub("b", "j1", 50), draft("b", "j2")] },
      judgeAssignment: { findMany: async () => [{ teamId: "a", judgeId: "j1" }] },
    } as unknown as JudgeResultsDb;
    const r = await getJudgeResults(db);
    assert.equal(r.winnerTeamId, "a");
    assert.equal(scoreOf(r, "a").assignedJudges, 1);
    // getJudgeResults takes no client input at all — there is nothing to inject a score through.
    assert.equal(getJudgeResults.length, 1);
  });

  // The results route is guarded by requireOrganizer, which applies this check.
  it("organizer allowed; judge and signed-out users denied", () => {
    assert.deepEqual(checkRole({ role: "ORGANIZER" }, "ORGANIZER"), { ok: true });
    assert.deepEqual(checkRole({ role: "JUDGE" }, "ORGANIZER"), { ok: false, status: 403 });
    assert.deepEqual(checkRole(null, "ORGANIZER"), { ok: false, status: 401 });
  });
});

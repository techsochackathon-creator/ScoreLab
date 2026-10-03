/**
 * Phase 7: judge workload and organizer judging-progress counts (pure functions).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { progressByJudge, summarizeProgress } from "../src/lib/judgeEvaluations";
import { buildJudgeResults } from "../src/lib/judgeResults";
import { finalizationBlockers, judgingProgress } from "../src/lib/officialResults";

describe("judge progress", () => {
  it("summarizes NOT_STARTED / DRAFT / SUBMITTED with a whole-percent completion", () => {
    assert.deepEqual(summarizeProgress(["SUBMITTED", "DRAFT", "NOT_STARTED", "SUBMITTED"]), {
      assigned: 4, submitted: 2, draft: 1, notStarted: 1, percent: 50,
    });
    assert.deepEqual(summarizeProgress(["SUBMITTED", "DRAFT", "DRAFT"]).percent, 33);
    assert.deepEqual(summarizeProgress([]), { assigned: 0, submitted: 0, draft: 0, notStarted: 0, percent: 0 });
  });

  it("per judge: only assigned teams count, each judge's own statuses, others' evaluations ignored", () => {
    const map = progressByJudge(
      [
        { judgeId: "A", teamId: "t1" }, { judgeId: "A", teamId: "t2" }, { judgeId: "A", teamId: "t3" },
        { judgeId: "B", teamId: "t1" },
      ],
      [
        { judgeId: "A", teamId: "t1", status: "SUBMITTED" },
        { judgeId: "A", teamId: "t2", status: "DRAFT" },
        { judgeId: "A", teamId: "t9", status: "SUBMITTED" }, // no longer assigned → not A's workload
        { judgeId: "B", teamId: "t2", status: "SUBMITTED" }, // B's evaluation must not leak into A's t2
      ],
    );
    assert.deepEqual(map.get("A")!.statusByTeam, { t1: "SUBMITTED", t2: "DRAFT", t3: "NOT_STARTED" });
    assert.deepEqual(map.get("A")!.progress, { assigned: 3, submitted: 1, draft: 1, notStarted: 1, percent: 33 });
    assert.deepEqual(map.get("B")!.statusByTeam, { t1: "NOT_STARTED" });
    assert.equal(map.get("B")!.progress.percent, 0);
    assert.equal(map.has("C"), false);
  });
});

describe("organizer judging progress", () => {
  const team = (id: string) => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: null });
  const results = buildJudgeResults({
    teams: ["a", "b", "c", "d"].map(team),
    evaluations: [
      { teamId: "a", judgeId: "j1", status: "SUBMITTED", finalScore: 80 },
      { teamId: "a", judgeId: "j2", status: "DRAFT", finalScore: null },
      { teamId: "b", judgeId: "j1", status: "DRAFT", finalScore: null },
      { teamId: "b", judgeId: "j2", status: "DRAFT", finalScore: null },
    ],
    assignments: [
      { teamId: "a", judgeId: "j1" }, { teamId: "a", judgeId: "j2" },
      { teamId: "b", judgeId: "j1" }, { teamId: "b", judgeId: "j2" },
      { teamId: "c", judgeId: "j1" },
    ],
  });

  it("counts teams with a submission, drafts only, and no evaluation", () => {
    const p = judgingProgress(results);
    assert.equal(p.totalTeams, 4);
    assert.equal(p.withSubmitted, 1); // a (its extra draft doesn't matter)
    assert.equal(p.draftsOnly, 1); // b
    assert.equal(p.noEvaluation, 2); // c (assigned, not started), d (no judge)
    assert.equal(p.percent, 25);
    assert.deepEqual(p.missing.map((t) => [t.teamCode, t.draftJudges, t.assignedJudges]), [["B", 2, 2], ["C", 0, 1], ["D", 0, 0]]);
  });

  it("missing teams are exactly the ones finalization reports", () => {
    const missing = judgingProgress(results).missing.map((t) => t.teamCode);
    const blockers = finalizationBlockers(results).join(" ");
    for (const code of missing) assert.match(blockers, new RegExp(`\\b${code}\\b`));
    assert.doesNotMatch(blockers, /\bA\b/);
  });

  it("empty event: zero teams, 0%", () => {
    const p = judgingProgress(buildJudgeResults({ teams: [], evaluations: [], assignments: [] }));
    assert.deepEqual([p.totalTeams, p.percent, p.missing.length], [0, 0, 0]);
  });
});

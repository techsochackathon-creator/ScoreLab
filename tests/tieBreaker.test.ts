import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  detectTies,
  resolveByHierarchy,
  resolveBySecondaryEval,
  resolveByOrganizer,
  applyTieBreaks,
  buildTiedTeam,
  defaultPriorityOrder,
  type TiedTeam,
  type SecondaryEvalResult,
  type TieResolution,
} from "../src/lib/tieBreaker";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeTiedTeam(
  id: string,
  name: string,
  score: number,
  criterionScores: Record<string, number>,
): TiedTeam {
  return buildTiedTeam(
    id,
    name,
    score,
    Object.entries(criterionScores).map(([criterionId, s]) => ({ criterionId, score: s })),
  );
}

function makeSecondaryResult(
  teamId: string,
  teamName: string,
  scores: { inn: number; use: number; ai: number; imp: number },
): SecondaryEvalResult {
  return {
    teamId,
    teamName,
    innovation: scores.inn,
    realWorldUsefulness: scores.use,
    aiIntegrationQuality: scores.ai,
    projectImpact: scores.imp,
    reasoning: `Evaluation for ${teamName}`,
    evidenceRefs: ["README.md"],
    tieBreakScore: scores.inn + scores.use + scores.ai + scores.imp,
  };
}

// ---------------------------------------------------------------------------
// Test 1: No ties — all unique scores → no tie groups
// ---------------------------------------------------------------------------
describe("Tie-break engine", () => {
  it("Test 1: No ties — unique scores produce no tie groups", () => {
    const teams = [
      { teamId: "t1", totalScore: 85 },
      { teamId: "t2", totalScore: 72 },
      { teamId: "t3", totalScore: 91 },
    ];
    const ties = detectTies(teams);
    assert.equal(ties.length, 0, "Should detect no tie groups");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Two teams tied → resolved by first criterion in hierarchy
  // ---------------------------------------------------------------------------
  it("Test 2: Two teams tied — resolved by first differentiating criterion", () => {
    const priority = ["crit-func", "crit-tech", "crit-code"];
    const teamA = makeTiedTeam("tA", "Alpha", 80, { "crit-func": 5, "crit-tech": 4, "crit-code": 3 });
    const teamB = makeTiedTeam("tB", "Bravo", 80, { "crit-func": 4, "crit-tech": 5, "crit-code": 3 });

    const result = resolveByHierarchy([teamA, teamB], priority);

    assert.equal(result.method, "CRITERION_HIERARCHY");
    assert.equal(result.needsFurtherResolution, false);
    assert.equal(result.resolvedOrder[0], "tA", "Alpha should win — higher on crit-func (priority 1)");
    assert.equal(result.resolvedBy, "crit-func");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Two teams tied on first criterion → resolved by second criterion
  // ---------------------------------------------------------------------------
  it("Test 3: Tied on first criterion — falls through to second", () => {
    const priority = ["crit-func", "crit-tech", "crit-code"];
    const teamA = makeTiedTeam("tA", "Alpha", 80, { "crit-func": 4, "crit-tech": 5, "crit-code": 3 });
    const teamB = makeTiedTeam("tB", "Bravo", 80, { "crit-func": 4, "crit-tech": 3, "crit-code": 5 });

    const result = resolveByHierarchy([teamA, teamB], priority);

    assert.equal(result.needsFurtherResolution, false);
    assert.equal(result.resolvedOrder[0], "tA", "Alpha wins on crit-tech (priority 2)");
    assert.ok(result.reasoning.includes("crit-tech"), "Audit should mention differentiating criterion");
  });

  // ---------------------------------------------------------------------------
  // Test 4: Three-way tie — partial resolution by hierarchy
  // ---------------------------------------------------------------------------
  it("Test 4: Three-way tie — hierarchy separates leader, remaining two still tied", () => {
    const priority = ["c1", "c2", "c3"];
    const teamA = makeTiedTeam("tA", "Alpha", 75, { c1: 5, c2: 3, c3: 3 });
    const teamB = makeTiedTeam("tB", "Bravo", 75, { c1: 4, c2: 4, c3: 4 });
    const teamC = makeTiedTeam("tC", "Charlie", 75, { c1: 4, c2: 4, c3: 4 });

    const result = resolveByHierarchy([teamA, teamB, teamC], priority);

    assert.equal(result.resolvedOrder[0], "tA", "Alpha leads on c1");
    // Bravo and Charlie remain tied on all criteria.
    assert.equal(result.needsFurtherResolution, true, "B and C still tied → need further resolution");
  });

  // ---------------------------------------------------------------------------
  // Test 5: All criteria exhausted — needs secondary evaluation
  // ---------------------------------------------------------------------------
  it("Test 5: All criteria identical — flags for secondary evaluation", () => {
    const priority = ["c1", "c2"];
    const teamA = makeTiedTeam("tA", "Alpha", 80, { c1: 4, c2: 4 });
    const teamB = makeTiedTeam("tB", "Bravo", 80, { c1: 4, c2: 4 });

    const result = resolveByHierarchy([teamA, teamB], priority);

    assert.equal(result.needsFurtherResolution, true);
    assert.ok(result.reasoning.includes("secondary evaluation"), "Should mention secondary evaluation");
  });

  // ---------------------------------------------------------------------------
  // Test 6: Secondary evaluation resolves tie
  // ---------------------------------------------------------------------------
  it("Test 6: Secondary evaluation breaks the tie", () => {
    const results: SecondaryEvalResult[] = [
      makeSecondaryResult("tA", "Alpha", { inn: 8, use: 7, ai: 9, imp: 6 }), // 30
      makeSecondaryResult("tB", "Bravo", { inn: 7, use: 8, ai: 6, imp: 5 }), // 26
    ];

    const resolution = resolveBySecondaryEval(results);

    assert.equal(resolution.method, "SECONDARY_EVALUATION");
    assert.equal(resolution.needsFurtherResolution, false);
    assert.equal(resolution.resolvedOrder[0], "tA", "Alpha wins with higher tieBreakScore");
  });

  // ---------------------------------------------------------------------------
  // Test 7: Secondary evaluation still tied → TIE_REQUIRES_ORGANIZER_DECISION
  // ---------------------------------------------------------------------------
  it("Test 7: Secondary evaluation produces same score → organizer must decide", () => {
    const results: SecondaryEvalResult[] = [
      makeSecondaryResult("tA", "Alpha", { inn: 7, use: 7, ai: 7, imp: 7 }), // 28
      makeSecondaryResult("tB", "Bravo", { inn: 7, use: 7, ai: 7, imp: 7 }), // 28
    ];

    const resolution = resolveBySecondaryEval(results);

    assert.equal(resolution.needsFurtherResolution, true);
    assert.ok(
      resolution.reasoning.includes("TIE_REQUIRES_ORGANIZER_DECISION"),
      "Must flag organizer decision",
    );
  });

  // ---------------------------------------------------------------------------
  // Test 8: Organizer manual resolution — valid
  // ---------------------------------------------------------------------------
  it("Test 8: Organizer resolves tie with valid ordering", () => {
    const resolution = resolveByOrganizer(
      ["tA", "tB"],
      ["tB", "tA"],
      "Bravo demonstrated superior innovation during the live demo.",
    );

    assert.equal(resolution.method, "ORGANIZER_DECISION");
    assert.equal(resolution.needsFurtherResolution, false);
    assert.deepEqual(resolution.resolvedOrder, ["tB", "tA"]);
    assert.ok(resolution.reasoning.includes("Organizer decision"));
  });

  // ---------------------------------------------------------------------------
  // Test 9: Organizer resolution rejects mismatched teams
  // ---------------------------------------------------------------------------
  it("Test 9: Organizer resolution rejects incomplete team set", () => {
    assert.throws(
      () => resolveByOrganizer(["tA", "tB"], ["tB"], "Missing team A"),
      /must include exactly the tied teams/,
    );

    assert.throws(
      () => resolveByOrganizer(["tA", "tB"], ["tB", "tA", "tC"], "Extra team C"),
      /must include exactly the tied teams/,
    );
  });

  // ---------------------------------------------------------------------------
  // Test 10: applyTieBreaks produces unique ranks for resolved ties
  // ---------------------------------------------------------------------------
  it("Test 10: applyTieBreaks assigns unique sequential ranks", () => {
    const teams = [
      { teamId: "t1", teamName: "First", totalScore: 90 },
      { teamId: "t2", teamName: "Tied-A", totalScore: 80 },
      { teamId: "t3", teamName: "Tied-B", totalScore: 80 },
      { teamId: "t4", teamName: "Last", totalScore: 70 },
    ];

    const resolutions = new Map<number, TieResolution>();
    resolutions.set(80, {
      resolvedOrder: ["t3", "t2"],
      method: "CRITERION_HIERARCHY",
      resolvedBy: "c1",
      reasoning: "Tied-B wins on c1",
      needsFurtherResolution: false,
    });

    const ranked = applyTieBreaks(teams, resolutions);

    assert.equal(ranked[0].rank, 1, "First place — score 90");
    assert.equal(ranked[0].teamId, "t1");
    assert.equal(ranked[1].rank, 2, "Second place — Tied-B (tie winner)");
    assert.equal(ranked[1].teamId, "t3");
    assert.equal(ranked[2].rank, 3, "Third place — Tied-A");
    assert.equal(ranked[2].teamId, "t2");
    assert.equal(ranked[3].rank, 4, "Fourth place — score 70");
    assert.equal(ranked[3].teamId, "t4");

    // All ranks should be unique.
    const ranks = ranked.map((r) => r.rank);
    assert.deepEqual(ranks, [1, 2, 3, 4], "All ranks unique and sequential");
  });

  // ---------------------------------------------------------------------------
  // Test 11: Configurable criterion priority order
  // ---------------------------------------------------------------------------
  it("Test 11: Custom priority order changes who wins the tie", () => {
    // With default priority [c1, c2, c3]: Alpha wins (higher on c1).
    const teamA = makeTiedTeam("tA", "Alpha", 80, { c1: 5, c2: 3, c3: 3 });
    const teamB = makeTiedTeam("tB", "Bravo", 80, { c1: 3, c2: 5, c3: 3 });

    const result1 = resolveByHierarchy([teamA, teamB], ["c1", "c2", "c3"]);
    assert.equal(result1.resolvedOrder[0], "tA", "Default order: Alpha wins on c1");

    // With reversed priority [c2, c1, c3]: Bravo wins (higher on c2).
    const result2 = resolveByHierarchy([teamA, teamB], ["c2", "c1", "c3"]);
    assert.equal(result2.resolvedOrder[0], "tB", "Reversed order: Bravo wins on c2");
  });

  // ---------------------------------------------------------------------------
  // Test 12: Original scores never modified — tie-break is metadata only
  // ---------------------------------------------------------------------------
  it("Test 12: Original scores remain unchanged after tie-break", () => {
    const teams = [
      { teamId: "t1", teamName: "First", totalScore: 90 },
      { teamId: "t2", teamName: "Tied-A", totalScore: 80 },
      { teamId: "t3", teamName: "Tied-B", totalScore: 80 },
    ];

    const resolutions = new Map<number, TieResolution>();
    resolutions.set(80, {
      resolvedOrder: ["t3", "t2"],
      method: "CRITERION_HIERARCHY",
      resolvedBy: "c1",
      reasoning: "Tied-B wins on c1",
      needsFurtherResolution: false,
    });

    const ranked = applyTieBreaks(teams, resolutions);

    // Verify original scores are untouched.
    for (const r of ranked) {
      const original = teams.find((t) => t.teamId === r.teamId)!;
      assert.equal(
        r.totalScore,
        original.totalScore,
        `Score for ${r.teamId} must remain ${original.totalScore}`,
      );
    }

    // Verify tie-break metadata is present only for tied teams.
    const first = ranked.find((r) => r.teamId === "t1")!;
    assert.equal(first.tieBreakRank, undefined, "Non-tied team should have no tieBreakRank");
    assert.equal(first.tieBreakMethod, undefined, "Non-tied team should have no tieBreakMethod");

    const tiedA = ranked.find((r) => r.teamId === "t2")!;
    assert.equal(tiedA.tieBreakMethod, "CRITERION_HIERARCHY", "Tied team should have method");
    assert.ok(tiedA.tieBreakRank !== undefined, "Tied team should have tieBreakRank");
  });

  // ---------------------------------------------------------------------------
  // Test: defaultPriorityOrder sorts by order field
  // ---------------------------------------------------------------------------
  it("defaultPriorityOrder sorts by criterion order field ascending", () => {
    const criteria = [
      { id: "c-doc", order: 4 },
      { id: "c-func", order: 1 },
      { id: "c-tech", order: 2 },
      { id: "c-code", order: 3 },
      { id: "c-struct", order: 5 },
    ];
    const order = defaultPriorityOrder(criteria);
    assert.deepEqual(order, ["c-func", "c-tech", "c-code", "c-doc", "c-struct"]);
  });

  // ---------------------------------------------------------------------------
  // Test: detectTies returns groups sorted by score descending
  // ---------------------------------------------------------------------------
  it("detectTies groups tied teams and sorts by score descending", () => {
    const teams = [
      { teamId: "t1", totalScore: 80 },
      { teamId: "t2", totalScore: 90 },
      { teamId: "t3", totalScore: 80 },
      { teamId: "t4", totalScore: 90 },
      { teamId: "t5", totalScore: 70 },
    ];
    const ties = detectTies(teams);
    assert.equal(ties.length, 2, "Two tie groups");
    assert.equal(ties[0].score, 90, "Highest tie first");
    assert.deepEqual(ties[0].teamIds.sort(), ["t2", "t4"]);
    assert.equal(ties[1].score, 80, "Lower tie second");
    assert.deepEqual(ties[1].teamIds.sort(), ["t1", "t3"]);
  });

  // ---------------------------------------------------------------------------
  // Test: Full audit trail from hierarchy → secondary → unresolved
  // ---------------------------------------------------------------------------
  it("Full audit chain: hierarchy fails → secondary still tied → unresolved", () => {
    // Step 1: Hierarchy can't differentiate.
    const teamA = makeTiedTeam("tA", "Alpha", 80, { c1: 4, c2: 4 });
    const teamB = makeTiedTeam("tB", "Bravo", 80, { c1: 4, c2: 4 });
    const hierarchyResult = resolveByHierarchy([teamA, teamB], ["c1", "c2"]);
    assert.equal(hierarchyResult.needsFurtherResolution, true);

    // Step 2: Secondary eval also ties.
    const secResults = [
      makeSecondaryResult("tA", "Alpha", { inn: 6, use: 6, ai: 6, imp: 6 }), // 24
      makeSecondaryResult("tB", "Bravo", { inn: 6, use: 6, ai: 6, imp: 6 }), // 24
    ];
    const secResolution = resolveBySecondaryEval(secResults);
    assert.equal(secResolution.needsFurtherResolution, true);

    // Full trail present.
    assert.ok(hierarchyResult.reasoning.includes("criteria exhausted"));
    assert.ok(secResolution.reasoning.includes("TIE_REQUIRES_ORGANIZER_DECISION"));
  });
});

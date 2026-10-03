import { test } from "node:test";
import assert from "node:assert/strict";
import { rubricVersionHash, buildRunRecord, appendRun, type RunRecordInput } from "../src/lib/evaluationVersion";

const RUBRIC_A = {
  name: "Default Rubric",
  criteria: [
    { name: "Code Quality", description: "d", weight: 50, scaleMax: 5, anchors: [{ score: 1, label: "x" }] },
    { name: "Documentation", description: "d", weight: 50, scaleMax: 5, anchors: [{ score: 1, label: "x" }] },
  ],
};

function inputFor(over: Partial<RunRecordInput> = {}): RunRecordInput {
  const now = new Date("2026-09-05T10:00:00Z");
  return {
    submissionId: "s1",
    teamId: "t1",
    repoUrl: "https://github.com/PROJECT_OWNER_REDACTED/x",
    commitSha: "abc123",
    evidenceFetchedAt: now,
    rubricVersion: rubricVersionHash(RUBRIC_A),
    promptVersion: "3.0",
    model: "gemini-3.6-flash",
    modelConfig: { temperature: 0 },
    status: "EVALUATED",
    finalScore: 80,
    confidence: 0.9,
    flags: [],
    criterionScores: [{ criterionId: "c1", name: "Code Quality", score: 4, weight: 50, scaleMax: 5, weighted: 40, confidence: 0.9, reasoning: "r", evidenceRefs: ["README"] }],
    rawEvidence: { readme: "raw readme with Ada Lovelace" },
    sanitizedEvidence: { readme: "sanitized readme" },
    startedAt: now,
    completedAt: now,
    ...over,
  };
}

test("rubric version hash is stable for identical content, different for changed weights", () => {
  const h1 = rubricVersionHash(RUBRIC_A);
  const h2 = rubricVersionHash({ ...RUBRIC_A, criteria: [...RUBRIC_A.criteria].reverse() }); // order-independent
  assert.equal(h1, h2, "hash is order-independent / content-stable");

  const changed = {
    ...RUBRIC_A,
    criteria: [
      { ...RUBRIC_A.criteria[0], weight: 60 },
      { ...RUBRIC_A.criteria[1], weight: 40 },
    ],
  };
  assert.notEqual(rubricVersionHash(changed), h1, "different weights → different version");
});

test("re-evaluation creates a NEW record; history grows and prior record is unchanged", () => {
  const run1 = buildRunRecord(inputFor({ finalScore: 70 }));
  const snapshot1 = JSON.stringify(run1);

  let history = appendRun([], run1);
  assert.equal(history.length, 1);

  const run2 = buildRunRecord(inputFor({ finalScore: 95 }));
  history = appendRun(history, run2);

  assert.equal(history.length, 2, "re-run appended a new record");
  assert.equal(history[0], run1, "same object reference retained");
  assert.equal(JSON.stringify(history[0]), snapshot1, "previous record unchanged");
  assert.equal(history[0].finalScore, 70);
  assert.equal(history[1].finalScore, 95);
});

test("previous evidence snapshot remains unchanged after a re-run", () => {
  const run1 = buildRunRecord(inputFor({ rawEvidence: { readme: "ORIGINAL" } }));
  let history = appendRun([], run1);
  history = appendRun(history, buildRunRecord(inputFor({ rawEvidence: { readme: "DIFFERENT" } })));
  assert.deepEqual(history[0].rawEvidence, { readme: "ORIGINAL" }, "old evidence preserved");
  assert.deepEqual(history[1].rawEvidence, { readme: "DIFFERENT" });
});

test("built records are frozen (cannot be mutated)", () => {
  const run = buildRunRecord(inputFor());
  assert.throws(() => {
    (run as { finalScore: number }).finalScore = 0; // frozen → throws at runtime
  });
});

test("different rubric versions can coexist in history", () => {
  const vA = rubricVersionHash(RUBRIC_A);
  const vB = rubricVersionHash({ ...RUBRIC_A, name: "Stricter Rubric", criteria: [{ ...RUBRIC_A.criteria[0], weight: 70 }, { ...RUBRIC_A.criteria[1], weight: 30 }] });
  const history = appendRun(appendRun([], buildRunRecord(inputFor({ rubricVersion: vA }))), buildRunRecord(inputFor({ rubricVersion: vB })));
  assert.equal(history[0].rubricVersion, vA);
  assert.equal(history[1].rubricVersion, vB);
  assert.notEqual(history[0].rubricVersion, history[1].rubricVersion);
});

test("different model/prompt versions can coexist in history", () => {
  const history = appendRun(
    appendRun([], buildRunRecord(inputFor({ model: "gemini-2.5-flash", promptVersion: "2.0" }))),
    buildRunRecord(inputFor({ model: "gemini-3.6-flash", promptVersion: "3.0" })),
  );
  assert.equal(history[0].model, "gemini-2.5-flash");
  assert.equal(history[0].promptVersion, "2.0");
  assert.equal(history[1].model, "gemini-3.6-flash");
  assert.equal(history[1].promptVersion, "3.0");
});

test("non-completed runs carry status but no totalScore", () => {
  const failed = buildRunRecord(inputFor({ status: "REVIEW_REQUIRED", finalScore: null, flags: ["IDENTITY_LEAKAGE"] }));
  assert.equal(failed.status, "REVIEW_REQUIRED");
  assert.equal(failed.totalScore, null);
  assert.deepEqual(failed.flags, ["IDENTITY_LEAKAGE"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFinalScore } from "../src/lib/scoring";

// Default rubric: 5 criteria, 20% each, scale 1..5.
const RUBRIC = [
  { id: "c1", weight: 20, scaleMax: 5 },
  { id: "c2", weight: 20, scaleMax: 5 },
  { id: "c3", weight: 20, scaleMax: 5 },
  { id: "c4", weight: 20, scaleMax: 5 },
  { id: "c5", weight: 20, scaleMax: 5 },
];
const scoresAll = (v: number) => RUBRIC.map((c) => ({ criterionId: c.id, score: v }));

test("all scores = 1 → 20", () => {
  const r = calculateFinalScore(RUBRIC, scoresAll(1));
  assert.equal(r.ok, true, r.errors.join(" "));
  assert.equal(r.finalScore, 20); // (1/5)*100
});

test("all scores = 3 → 60", () => {
  const r = calculateFinalScore(RUBRIC, scoresAll(3));
  assert.equal(r.finalScore, 60);
});

test("all scores = 5 → 100", () => {
  const r = calculateFinalScore(RUBRIC, scoresAll(5));
  assert.equal(r.finalScore, 100);
});

test("mixed scores compute deterministically", () => {
  const scores = [
    { criterionId: "c1", score: 5 }, // 20
    { criterionId: "c2", score: 4 }, // 16
    { criterionId: "c3", score: 3 }, // 12
    { criterionId: "c4", score: 2 }, // 8
    { criterionId: "c5", score: 1 }, // 4
  ];
  const r = calculateFinalScore(RUBRIC, scores);
  assert.equal(r.finalScore, 60);
  // deterministic: same inputs → same output
  assert.equal(calculateFinalScore(RUBRIC, scores).finalScore, 60);
  // per-criterion weighted contributions are exposed
  assert.deepEqual(r.breakdown.map((b) => b.weighted), [20, 16, 12, 8, 4]);
});

test("different rubric weights are respected", () => {
  const rubric = [
    { id: "a", weight: 50, scaleMax: 5 },
    { id: "b", weight: 30, scaleMax: 5 },
    { id: "c", weight: 20, scaleMax: 10 },
  ];
  const r = calculateFinalScore(rubric, [
    { criterionId: "a", score: 5 }, // (5/5)*50 = 50
    { criterionId: "b", score: 4 }, // (4/5)*30 = 24
    { criterionId: "c", score: 5 }, // (5/10)*20 = 10
  ]);
  assert.equal(r.ok, true, r.errors.join(" "));
  assert.equal(r.finalScore, 84);
});

test("invalid weights (do not sum to 100) fail", () => {
  const rubric = [
    { id: "a", weight: 40, scaleMax: 5 },
    { id: "b", weight: 40, scaleMax: 5 },
  ];
  const r = calculateFinalScore(rubric, [
    { criterionId: "a", score: 5 },
    { criterionId: "b", score: 5 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.finalScore, null);
  assert.ok(r.errors.some((e) => /sum to 80/.test(e)));
});

test("missing criterion fails", () => {
  const r = calculateFinalScore(RUBRIC, scoresAll(3).slice(0, 4)); // c5 missing
  assert.equal(r.ok, false);
  assert.equal(r.finalScore, null);
  assert.ok(r.errors.some((e) => /Missing score for criterion "c5"/.test(e)));
});

test("duplicate criterion fails", () => {
  const scores = [...scoresAll(3), { criterionId: "c1", score: 5 }];
  const r = calculateFinalScore(RUBRIC, scores);
  assert.equal(r.ok, false);
  assert.equal(r.finalScore, null);
  assert.ok(r.errors.some((e) => /"c1" scored 2 times/.test(e)));
});

test("unknown criterion in scores fails", () => {
  const r = calculateFinalScore(RUBRIC, [...scoresAll(3), { criterionId: "cX", score: 3 }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /unknown criterion "cX"/i.test(e)));
});

test("out-of-range and non-integer scores fail", () => {
  const bad = calculateFinalScore(RUBRIC, [
    { criterionId: "c1", score: 7 },
    { criterionId: "c2", score: 3 },
    { criterionId: "c3", score: 3 },
    { criterionId: "c4", score: 3 },
    { criterionId: "c5", score: 3 },
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /outside 1\.\.5/.test(e)));

  const frac = calculateFinalScore(RUBRIC, [
    { criterionId: "c1", score: 3.5 },
    { criterionId: "c2", score: 3 },
    { criterionId: "c3", score: 3 },
    { criterionId: "c4", score: 3 },
    { criterionId: "c5", score: 3 },
  ]);
  assert.equal(frac.ok, false);
  assert.ok(frac.errors.some((e) => /must be an integer/.test(e)));
});

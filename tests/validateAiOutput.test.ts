import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAiOutput, validateRubricWeights } from "../src/lib/validateAiOutput";

const CRITERIA = [
  { id: "c1", name: "Code Quality", scaleMax: 5 },
  { id: "c2", name: "Documentation", scaleMax: 5 },
];
const KNOWN = ["README.md", "package.json", "src/index.ts"];
const OPTS = { criteria: CRITERIA, knownFiles: KNOWN, hasReadme: true };

function entry(over: Record<string, unknown> = {}) {
  return { criterionId: "c1", score: 4, confidence: 0.8, reasoning: "Well structured and typed code.", evidenceRefs: ["src/index.ts"], ...over };
}
function output(items: unknown[]) {
  return JSON.stringify({ scores: items });
}
const codes = (r: ReturnType<typeof validateAiOutput>) => r.issues.map((i) => i.code);

test("valid output passes and returns normalized scores", () => {
  const r = validateAiOutput(output([entry(), entry({ criterionId: "c2", reasoning: "Clear README with setup steps.", evidenceRefs: ["README"] })]), OPTS);
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.equal(r.scores?.length, 2);
});

test("malformed JSON is rejected", () => {
  const r = validateAiOutput("{ not json", OPTS);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MALFORMED_JSON"));
});

test("missing criterion is detected", () => {
  const r = validateAiOutput(output([entry()]), OPTS); // c2 missing
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MISSING_CRITERION"));
});

test("duplicate criteria are detected", () => {
  const r = validateAiOutput(output([entry(), entry(), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r).includes("DUPLICATE_CRITERION"));
});

test("unexpected criterion id is rejected", () => {
  const r = validateAiOutput(output([entry(), entry({ criterionId: "c2", evidenceRefs: ["README"] }), entry({ criterionId: "c99" })]), OPTS);
  assert.ok(codes(r).includes("UNEXPECTED_CRITERION"));
});

test("invalid score type and out-of-range are detected", () => {
  const t = validateAiOutput(output([entry({ score: "five" }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(t).includes("INVALID_SCORE_TYPE"));
  const rng = validateAiOutput(output([entry({ score: 9 }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(rng).includes("SCORE_OUT_OF_RANGE"));
});

test("invalid confidence is detected", () => {
  const r = validateAiOutput(output([entry({ confidence: 1.7 }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r).includes("INVALID_CONFIDENCE"));
  const r2 = validateAiOutput(output([entry({ confidence: "high" }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r2).includes("INVALID_CONFIDENCE"));
});

test("empty reasoning is detected", () => {
  const r = validateAiOutput(output([entry({ reasoning: "  " }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r).includes("EMPTY_REASONING"));
});

test("missing evidence references are detected", () => {
  const r = validateAiOutput(output([entry({ evidenceRefs: [] }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r).includes("MISSING_EVIDENCE"));
});

test("hallucinated evidence is detected", () => {
  const r = validateAiOutput(output([entry({ evidenceRefs: ["src/does-not-exist.ts"] }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.ok(codes(r).includes("HALLUCINATED_EVIDENCE"));
});

test("descriptive (non-file) evidence refs are allowed", () => {
  const r = validateAiOutput(output([entry({ evidenceRefs: ["commit history", "file tree"] }), entry({ criterionId: "c2", evidenceRefs: ["README"] })]), OPTS);
  assert.equal(r.valid, true, JSON.stringify(r.issues));
});

test("the model cannot supply a final/weighted score", () => {
  const raw = JSON.stringify({ totalScore: 88, scores: [entry(), entry({ criterionId: "c2", evidenceRefs: ["README"] })] });
  const r = validateAiOutput(raw, OPTS);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("FORBIDDEN_FINAL_SCORE"));
});

test("rubric weights must total 100%", () => {
  assert.equal(validateRubricWeights([{ weight: 20 }, { weight: 30 }]).valid, false);
  assert.equal(validateRubricWeights([{ weight: 50 }, { weight: 50 }]).valid, true);
});

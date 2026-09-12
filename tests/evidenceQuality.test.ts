import { test } from "node:test";
import assert from "node:assert/strict";
import { assessEvidence } from "../src/lib/evidenceQuality";
import type { RepoEvidence } from "../src/lib/github";

const RUBRIC = [
  { id: "c1", name: "Code Quality" },
  { id: "c2", name: "Documentation" },
  { id: "c3", name: "Functionality / Completeness" },
  { id: "c4", name: "Technical Complexity" },
  { id: "c5", name: "Project Structure" },
];

function ev(over: Partial<RepoEvidence> = {}): RepoEvidence {
  return {
    owner: "o", repo: "r", description: null, defaultBranch: "main", language: "TypeScript",
    license: null, stars: 0, pushedAt: null, readme: null, fileTree: [], fileCount: 0,
    keyFiles: [], commitCount: null, contributorCount: null, headSha: null, ...over,
  };
}
const levelOf = (res: ReturnType<typeof assessEvidence>, id: string) =>
  res.criteria.find((c) => c.criterionId === id)!.level;

test("complete repository → SUFFICIENT with high confidence", () => {
  const tree = ["README.md", "package.json", "tsconfig.json", "src/index.ts", "src/app.ts", "src/lib/util.ts", "src/api.ts", "tests/app.test.ts"];
  const res = assessEvidence(
    ev({
      readme: "x".repeat(1200),
      fileTree: tree,
      fileCount: tree.length,
      keyFiles: [
        { path: "package.json", content: "{}", truncated: false },
        { path: "src/index.ts", content: "code", truncated: false },
        { path: "src/app.ts", content: "code", truncated: false },
      ],
      commitCount: 40,
      contributorCount: 3,
    }),
    RUBRIC,
  );
  assert.equal(res.status, "SUFFICIENT");
  assert.ok(res.confidence > 0.6, `confidence ${res.confidence}`);
  assert.equal(levelOf(res, "c1"), "DIRECT"); // code quality
  assert.equal(levelOf(res, "c2"), "DIRECT"); // documentation
});

test("README-only repository → LIMITED; code criterion has NO evidence", () => {
  const res = assessEvidence(
    ev({ readme: "x".repeat(600), fileTree: ["README.md"], fileCount: 1 }),
    RUBRIC,
  );
  assert.equal(res.status, "LIMITED");
  assert.equal(levelOf(res, "c2"), "DIRECT"); // documentation present
  assert.equal(levelOf(res, "c1"), "NONE");   // no source → no code evidence
});

test("almost-empty repository → INSUFFICIENT", () => {
  const res = assessEvidence(ev({ fileTree: [], fileCount: 0 }), RUBRIC);
  assert.equal(res.status, "INSUFFICIENT");
  assert.ok(res.confidence < 0.2, `confidence ${res.confidence}`);
  assert.ok(res.missing.includes("source code files"));
});

test("missing source files → not SUFFICIENT; code criterion NONE", () => {
  const res = assessEvidence(
    ev({ readme: "x".repeat(400), fileTree: ["README.md", "docs/guide.md", ".env.example"], fileCount: 3 }),
    RUBRIC,
  );
  assert.notEqual(res.status, "SUFFICIENT");
  assert.equal(levelOf(res, "c1"), "NONE");
  assert.ok(res.missing.includes("source code files"));
});

test("missing README → documentation NONE and README listed missing", () => {
  const tree = ["package.json", "src/index.ts", "src/a.ts", "src/b.ts"];
  const res = assessEvidence(
    ev({ readme: null, fileTree: tree, fileCount: tree.length, keyFiles: [{ path: "src/index.ts", content: "code", truncated: false }], commitCount: 10, contributorCount: 2 }),
    RUBRIC,
  );
  assert.equal(levelOf(res, "c2"), "NONE");
  assert.ok(res.missing.includes("README / documentation"));
  assert.notEqual(res.status, "INSUFFICIENT"); // source present → still scoreable
});

test("criterion with no evidence is reported as NONE", () => {
  const res = assessEvidence(ev({ readme: "x".repeat(400), fileTree: ["README.md"], fileCount: 1 }), RUBRIC);
  // Technical Complexity + Functionality have no source → NONE
  assert.equal(levelOf(res, "c4"), "NONE");
  assert.ok(["NONE", "INDIRECT"].includes(levelOf(res, "c3")));
});

test("confidence increases monotonically with more evidence", () => {
  const empty = assessEvidence(ev({ fileTree: [], fileCount: 0 }), RUBRIC).confidence;
  const readmeOnly = assessEvidence(ev({ readme: "x".repeat(600), fileTree: ["README.md"], fileCount: 1 }), RUBRIC).confidence;
  const full = assessEvidence(
    ev({ readme: "x".repeat(1200), fileTree: ["README.md", "package.json", "src/a.ts", "src/b.ts", "src/c.ts"], fileCount: 5, keyFiles: [{ path: "src/a.ts", content: "c", truncated: false }], commitCount: 20, contributorCount: 3 }),
    RUBRIC,
  ).confidence;
  assert.ok(empty < readmeOnly && readmeOnly < full, `${empty} < ${readmeOnly} < ${full}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anonymizeEvidence,
  buildIdentityContext,
  redactText,
  sanitizeReadme,
  OWNER_PLACEHOLDER,
  UNIVERSITY_PLACEHOLDER,
  type IdentityContext,
} from "../src/lib/anonymize";

const CTX: IdentityContext = {
  ownerLogin: "reejasohail88",
  teamName: "Neon Owls",
  university: "State University",
  memberNames: ["Ada Lovelace", "Alan Turing"],
};

test("removes GitHub owner username (plain and in URL)", () => {
  const out = redactText("Repo https://github.com/reejasohail88/ApexRadar by reejasohail88.", CTX);
  assert.ok(!out.includes("reejasohail88"), "owner login should be gone");
  assert.ok(out.includes(OWNER_PLACEHOLDER));
  assert.ok(out.includes("ApexRadar"), "project/repo name is preserved");
});

test("removes email addresses", () => {
  const out = redactText("Contact ada@example.com or team.lead@uni.edu.pk", CTX);
  assert.ok(!/@example\.com|@uni\.edu/.test(out), "emails should be gone");
  assert.match(out, /EMAIL_001/);
  assert.match(out, /EMAIL_002/);
});

test("removes contributor / participant names (full and tokens)", () => {
  const out = redactText("Built by Ada Lovelace and Alan Turing. Ada led the model work.", CTX);
  for (const name of ["Ada", "Lovelace", "Alan", "Turing"]) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(out), `${name} should be redacted`);
  }
  assert.match(out, /CONTRIBUTOR_00\d/);
});

test("removes university name", () => {
  const out = redactText("Submitted from State University.", CTX);
  assert.ok(!out.includes("State University"));
  assert.ok(out.includes(UNIVERSITY_PLACEHOLDER));
});

test("preserves technical terms, packages, and frameworks", () => {
  const text =
    "Built with React, Next.js, TypeScript, Prisma, PostgreSQL, the Gemini API and @vercel/blob. Uses React state management.";
  const out = redactText(text, CTX);
  for (const term of ["React", "Next.js", "TypeScript", "Prisma", "PostgreSQL", "Gemini", "@vercel/blob", "state management"]) {
    assert.ok(out.includes(term), `${term} must be preserved`);
  }
  // "State University" would redact, but a bare technical "state" must survive.
  assert.ok(out.includes("state management"));
});

test("preserves code identifiers and file names; redacts identity in content", () => {
  const raw = makeEvidence({
    fileTree: ["src/index.ts", "app/page.tsx", "prisma/schema.prisma"],
    keyFiles: [
      { path: "src/index.ts", content: "// author: Ada Lovelace <ada@example.com>\nimport React from 'react';\nconst owner = 'reejasohail88';", truncated: false },
    ],
  });
  const { sanitized } = anonymizeEvidence(raw, CTX);
  assert.deepEqual(sanitized.fileTree, raw.fileTree, "file tree preserved");
  assert.equal(sanitized.keyFiles[0].path, "src/index.ts", "file name preserved");
  const c = sanitized.keyFiles[0].content;
  assert.ok(c.includes("import React from 'react'"), "code preserved");
  assert.ok(!c.includes("Ada Lovelace") && !c.includes("ada@example.com") && !c.includes("reejasohail88"), "identity in code redacted");
  assert.equal(sanitized.owner, OWNER_PLACEHOLDER, "owner neutralized");
});

test("README sanitization is deterministic and identity-free", () => {
  const readme = "# Project by Ada Lovelace (ada@example.com), State University.\nUses React and Prisma.";
  const a = sanitizeReadme(readme, CTX);
  const b = sanitizeReadme(readme, CTX);
  assert.equal(a, b, "same input → same output (deterministic)");
  assert.ok(!a.includes("Ada") && !a.includes("ada@example.com") && !a.includes("State University"));
  assert.ok(a.includes("React") && a.includes("Prisma"), "technical terms preserved");
});

test("raw evidence is never mutated; report reflects redactions", () => {
  const raw = makeEvidence({ readme: "By Ada Lovelace, reejasohail88, ada@example.com, State University." });
  const before = JSON.stringify(raw);
  const { sanitized, report } = anonymizeEvidence(raw, buildIdentityContext(
    { name: CTX.teamName, university: CTX.university, memberNames: CTX.memberNames },
    CTX.ownerLogin,
  ));
  assert.equal(JSON.stringify(raw), before, "raw object unchanged");
  assert.notEqual(sanitized.readme, raw.readme);
  assert.ok(report.emailsRedacted >= 1 && report.ownerRedacted && report.universityRedacted && report.contributorsRedacted >= 1);
});

// --- helper: full RepoEvidence with sensible defaults ---
function makeEvidence(over: Partial<import("../src/lib/github").RepoEvidence> = {}): import("../src/lib/github").RepoEvidence {
  return {
    owner: "reejasohail88",
    repo: "ApexRadar",
    description: null,
    defaultBranch: "main",
    language: "TypeScript",
    license: null,
    stars: 0,
    pushedAt: null,
    readme: null,
    fileTree: [],
    fileCount: 0,
    keyFiles: [],
    commitCount: null,
    contributorCount: null,
    headSha: null,
    ...over,
  };
}

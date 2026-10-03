import type { RepoEvidence } from "@/lib/github";

/**
 * Evidence completeness validation. Runs BEFORE Gemini to decide whether there
 * is enough evidence to reasonably score the rubric.
 *
 * `confidence` (0..1) represents evidence SUFFICIENCY/DIRECTNESS — how much real
 * evidence backs a scoring decision — NOT the model's certainty. It is stored
 * and surfaced for transparency and must NOT be multiplied into scores.
 */

export type CompletenessStatus = "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
export type CriterionEvidenceLevel = "DIRECT" | "INDIRECT" | "NONE";

export interface EvidenceSignals {
  hasReadme: boolean;
  readmeLength: number;
  fileCount: number;
  sourceFileCount: number;
  hasPackageManifest: boolean;
  hasConfig: boolean;
  hasTests: boolean;
  keyFileCount: number;
  commitCount: number | null;
  contributorCount: number | null;
}

export interface CriterionEvidence {
  criterionId: string;
  name: string;
  level: CriterionEvidenceLevel;
  note: string;
}

export interface EvidenceCompleteness {
  status: CompletenessStatus;
  confidence: number; // 0..1 sufficiency/directness
  signals: EvidenceSignals;
  missing: string[];
  criteria: CriterionEvidence[];
}

const SOURCE_RE = /\.(ts|tsx|js|jsx|py|go|java|rb|rs|php|c|cc|cpp|h|hpp|cs|kt|swift|vue|svelte|scala|dart|m|mm)$/i;
const TEST_RE = /(\.(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__|spec)\/)/i;
const CONFIG_RE = /(^|\/)(tsconfig(\.\w+)?\.json|next\.config\.\w+|vite\.config\.\w+|webpack\.config\.\w+|\.eslintrc|\.prettierrc|dockerfile|docker-compose\.ya?ml|makefile|\.env\.example|tailwind\.config\.\w+|babel\.config\.\w+|nginx\.conf)/i;
const PACKAGE_RE = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|build\.gradle|gemfile|composer\.json|pubspec\.yaml)$/i;

function computeSignals(ev: RepoEvidence): EvidenceSignals {
  const tree = ev.fileTree ?? [];
  return {
    hasReadme: !!ev.readme && ev.readme.trim().length > 0,
    readmeLength: ev.readme?.trim().length ?? 0,
    fileCount: ev.fileCount ?? tree.length,
    sourceFileCount: tree.filter((p) => SOURCE_RE.test(p)).length,
    hasPackageManifest: tree.some((p) => PACKAGE_RE.test(p)),
    hasConfig: tree.some((p) => CONFIG_RE.test(p)),
    hasTests: tree.some((p) => TEST_RE.test(p)),
    keyFileCount: ev.keyFiles?.length ?? 0,
    commitCount: ev.commitCount,
    contributorCount: ev.contributorCount,
  };
}

/** Graded 0..1 evidence-sufficiency confidence (not model certainty). */
function computeConfidence(s: EvidenceSignals): number {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const parts: [number, number][] = [
    [0.2, s.hasReadme ? clamp(s.readmeLength / 800) : 0],
    [0.3, clamp(s.sourceFileCount / 8)],
    [0.15, clamp(s.keyFileCount / 3)],
    [0.1, s.hasPackageManifest ? 1 : 0],
    [0.05, s.hasConfig ? 1 : 0],
    [0.05, s.hasTests ? 1 : 0],
    [0.08, s.commitCount != null ? clamp(s.commitCount / 10) : 0],
    [0.07, s.contributorCount != null ? clamp(s.contributorCount / 2) : 0],
  ];
  return Math.round(parts.reduce((acc, [w, v]) => acc + w * v, 0) * 100) / 100;
}

/** Structural status: hard gates first, then the SUFFICIENT bar. */
function classify(s: EvidenceSignals): CompletenessStatus {
  const meaningfulDocs = s.hasReadme && s.readmeLength >= 100;
  if (s.fileCount === 0) return "INSUFFICIENT";
  if (s.sourceFileCount === 0 && !meaningfulDocs) return "INSUFFICIENT";
  if (s.hasReadme && s.sourceFileCount >= 3 && s.keyFileCount >= 1) return "SUFFICIENT";
  return "LIMITED";
}

function missingList(s: EvidenceSignals): string[] {
  const m: string[] = [];
  if (!s.hasReadme) m.push("README / documentation");
  if (s.sourceFileCount === 0) m.push("source code files");
  if (s.keyFileCount === 0) m.push("readable source file contents");
  if (!s.hasPackageManifest) m.push("dependency/package manifest");
  if (s.commitCount == null) m.push("commit history");
  if (s.contributorCount == null) m.push("contributor metadata");
  return m;
}

const has = (name: string, ...keys: string[]) => keys.some((k) => name.includes(k));

/** Per-criterion evidence availability, mapped from the criterion name. */
function criterionLevel(name: string, s: EvidenceSignals): { level: CriterionEvidenceLevel; note: string } {
  const n = name.toLowerCase();

  if (has(n, "document", "readme", "docs")) {
    if (s.hasReadme && s.readmeLength >= 300) return { level: "DIRECT", note: "README present with substantial content" };
    if (s.hasReadme) return { level: "INDIRECT", note: "short README only" };
    return { level: "NONE", note: "no README/documentation" };
  }
  if (has(n, "test")) {
    if (s.hasTests) return { level: "DIRECT", note: "test files/directories present" };
    if (s.sourceFileCount > 0) return { level: "INDIRECT", note: "source present but no tests found" };
    return { level: "NONE", note: "no tests or source" };
  }
  if (has(n, "structure", "organization", "architecture")) {
    if (s.fileCount >= 5) return { level: "DIRECT", note: "file tree available" };
    if (s.fileCount > 0) return { level: "INDIRECT", note: "few files" };
    return { level: "NONE", note: "empty repository" };
  }
  if (has(n, "complex", "technical", "sophistication", "innovation")) {
    if (s.keyFileCount >= 1 && s.hasPackageManifest) return { level: "DIRECT", note: "source contents + dependencies available" };
    if (s.sourceFileCount > 0 || s.hasPackageManifest) return { level: "INDIRECT", note: "partial technical evidence" };
    return { level: "NONE", note: "no source or dependency evidence" };
  }
  if (has(n, "functional", "completeness", "feature", "working", "implementation")) {
    if (s.sourceFileCount >= 3 && s.hasReadme) return { level: "DIRECT", note: "source + described features" };
    if (s.sourceFileCount > 0 || s.hasReadme) return { level: "INDIRECT", note: "partial functional evidence" };
    return { level: "NONE", note: "no source or feature description" };
  }
  if (has(n, "code quality", "readab", "clean", "quality", "code")) {
    if (s.keyFileCount >= 1) return { level: "DIRECT", note: "source file contents available" };
    if (s.sourceFileCount > 0) return { level: "INDIRECT", note: "source files present, contents not fetched" };
    return { level: "NONE", note: "no source files" };
  }
  // Generic fallback.
  if (s.keyFileCount >= 1) return { level: "DIRECT", note: "source contents available" };
  if (s.fileCount > 0 || s.hasReadme) return { level: "INDIRECT", note: "some evidence available" };
  return { level: "NONE", note: "no meaningful evidence" };
}

export function assessEvidence(
  evidence: RepoEvidence,
  criteria: { id: string; name: string }[],
): EvidenceCompleteness {
  const signals = computeSignals(evidence);
  const status = classify(signals);
  const confidence = computeConfidence(signals);
  const criteriaEvidence: CriterionEvidence[] = criteria.map((c) => {
    const { level, note } = criterionLevel(c.name, signals);
    return { criterionId: c.id, name: c.name, level, note };
  });
  return { status, confidence, signals, missing: missingList(signals), criteria: criteriaEvidence };
}

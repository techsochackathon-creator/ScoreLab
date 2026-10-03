import type { RepoEvidence } from "@/lib/github";

/**
 * Deterministic anonymization / redaction for evaluation evidence.
 *
 * Pipeline role:
 *   GitHub evidence (raw) → anonymizeEvidence() → sanitized evidence → Gemini
 *
 * The raw evidence is never mutated — anonymizeEvidence returns a sanitized COPY
 * and a report. Callers persist the raw snapshot for audit and send only the
 * sanitized copy to the model.
 *
 * What is redacted: repo owner login, participant/contributor names, emails,
 * university names, and the team name. What is deliberately PRESERVED: languages,
 * frameworks, libraries, packages (including @scoped npm names), APIs, model
 * names, architecture, file/path names, and all technical implementation detail.
 * Only known identity terms + email patterns are touched, so technical content
 * is left intact.
 */

export interface IdentityContext {
  /** GitHub repository owner login (e.g. "octocat"). */
  ownerLogin?: string | null;
  teamName?: string | null;
  university?: string | null;
  memberNames?: string[];
}

export interface AnonymizationReport {
  emailsRedacted: number;
  ownerRedacted: boolean;
  contributorsRedacted: number;
  universityRedacted: boolean;
  teamRedacted: boolean;
  totalReplacements: number;
}

export const OWNER_PLACEHOLDER = "PROJECT_OWNER_REDACTED";
export const UNIVERSITY_PLACEHOLDER = "UNIVERSITY_REDACTED";
export const TEAM_PLACEHOLDER = "TEAM_REDACTED";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad = (n: number) => String(n).padStart(3, "0");

interface Term {
  re: RegExp;
  placeholder: string;
}

/**
 * Stateful redactor. Reuse one instance across all fields of a single evidence
 * bundle so the same email/identity maps to the same placeholder everywhere.
 */
export class Redactor {
  private emailMap = new Map<string, string>();
  private terms: Term[] = [];
  private counts = new Map<string, number>();

  constructor(ctx: IdentityContext) {
    const add = (term: string | null | undefined, placeholder: string, minLen = 3) => {
      if (!term) return;
      const t = term.trim();
      if (t.length < minLen) return;
      this.terms.push({ re: new RegExp(`\\b${escapeRe(t)}\\b`, "gi"), placeholder });
    };

    // Repo owner login (GitHub username).
    add(ctx.ownerLogin, OWNER_PLACEHOLDER);

    // Contributors / participants — deterministic numbering by sorted name.
    const members = [...new Set((ctx.memberNames ?? []).map((m) => m.trim()).filter(Boolean))].sort(
      (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    members.forEach((name, i) => {
      const ph = `CONTRIBUTOR_${pad(i + 1)}`;
      add(name, ph); // full name
      for (const tok of name.split(/\s+/)) add(tok, ph, 3); // individual name tokens
    });

    // University — full string only. Token-splitting is intentionally avoided so
    // common words ("State", "Institute", "College") never clobber technical text.
    add(ctx.university, UNIVERSITY_PLACEHOLDER, 3);

    // Team name — full string plus tokens of length >= 4 (avoids nuking "AI").
    if (ctx.teamName) {
      add(ctx.teamName, TEAM_PLACEHOLDER, 3);
      for (const tok of ctx.teamName.split(/\s+/)) add(tok, TEAM_PLACEHOLDER, 4);
    }

    // Longest patterns first, so full names replace before their tokens.
    this.terms.sort((a, b) => b.re.source.length - a.re.source.length);
  }

  private bump(key: string) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Redact one string; safe on null/undefined (returned unchanged). */
  redact<T extends string | null | undefined>(text: T): T {
    if (text == null) return text;
    let out = String(text);
    out = out.replace(EMAIL_RE, (m) => {
      let ph = this.emailMap.get(m);
      if (!ph) {
        ph = `EMAIL_${pad(this.emailMap.size + 1)}`;
        this.emailMap.set(m, ph);
      }
      this.bump("__email__");
      return ph;
    });
    for (const { re, placeholder } of this.terms) {
      out = out.replace(re, () => {
        this.bump(placeholder);
        return placeholder;
      });
    }
    return out as T;
  }

  report(): AnonymizationReport {
    let total = 0;
    for (const v of this.counts.values()) total += v;
    const contributors = [...this.counts.keys()].filter(
      (k) => k.startsWith("CONTRIBUTOR_") && (this.counts.get(k) ?? 0) > 0,
    ).length;
    return {
      emailsRedacted: this.emailMap.size,
      ownerRedacted: (this.counts.get(OWNER_PLACEHOLDER) ?? 0) > 0,
      contributorsRedacted: contributors,
      universityRedacted: (this.counts.get(UNIVERSITY_PLACEHOLDER) ?? 0) > 0,
      teamRedacted: (this.counts.get(TEAM_PLACEHOLDER) ?? 0) > 0,
      totalReplacements: total,
    };
  }
}

export function createRedactor(ctx: IdentityContext): Redactor {
  return new Redactor(ctx);
}

/** Convenience: redact a single string with a fresh redactor. */
export function redactText(text: string, ctx: IdentityContext): string {
  return new Redactor(ctx).redact(text);
}

/**
 * Deterministic README sanitization. The README is untrusted project content:
 * identity is redacted here, and instruction-safety is enforced structurally by
 * the evaluation prompt (README is delimited as untrusted data, never obeyed).
 */
export function sanitizeReadme(readme: string, ctx: IdentityContext): string {
  return new Redactor(ctx).redact(readme);
}

export function buildIdentityContext(
  team: { name?: string | null; university?: string | null; memberNames?: string[] },
  ownerLogin?: string | null,
): IdentityContext {
  return {
    ownerLogin,
    teamName: team.name ?? null,
    university: team.university ?? null,
    memberNames: team.memberNames ?? [],
  };
}

/**
 * Produce a sanitized COPY of the evidence (raw is never mutated) plus a report.
 * Owner login is neutralized; description, README, and key-file contents are
 * redacted. File names, the file tree, language, and counts are preserved.
 */
export function anonymizeEvidence(
  raw: RepoEvidence,
  ctx: IdentityContext,
): { sanitized: RepoEvidence; report: AnonymizationReport } {
  const r = new Redactor(ctx);
  const sanitized: RepoEvidence = {
    ...raw,
    owner: OWNER_PLACEHOLDER,
    description: r.redact(raw.description),
    readme: r.redact(raw.readme),
    keyFiles: raw.keyFiles.map((f) => ({ ...f, content: r.redact(f.content) })),
    // repo name, defaultBranch, language, license, stars, pushedAt, fileTree,
    // fileCount, commit/contributor counts are technical/meta → preserved as-is.
  };
  return { sanitized, report: r.report() };
}

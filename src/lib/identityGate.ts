import type { RepoEvidence } from "@/lib/github";
import { OWNER_PLACEHOLDER, type IdentityContext } from "@/lib/anonymize";

/**
 * Security gate: detect identity information that survived anonymization.
 *
 * Runs AFTER anonymizeEvidence() and BEFORE Gemini. If it reports leakage the
 * caller must NOT call the model — the evaluation becomes REVIEW_REQUIRED.
 *
 * Pattern checks (emails, personal profile URLs, mailto) need no context.
 * When an IdentityContext is supplied, residual known identifiers (owner login,
 * participant names, university, team name) are also treated as leakage — this
 * catches any miss by the redactor.
 */

export interface LeakageResult {
  leaked: boolean;
  reasons: string[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MAILTO_RE = /mailto:/i;
const LINKEDIN_RE = /linkedin\.com\/in\//i;
const SOCIAL_RE = /(?:twitter\.com|x\.com|facebook\.com|instagram\.com)\/[A-Za-z0-9_.]{2,}/i;
// A GitHub *profile* URL: github.com/<user> with no second path segment.
const GH_PROFILE_RE = /github\.com\/([A-Za-z0-9-]+)(?![A-Za-z0-9\-/])/gi;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Flatten all evaluator-visible text from the (sanitized) evidence. */
function collectText(ev: RepoEvidence): string {
  return [
    ev.owner,
    ev.description ?? "",
    ev.readme ?? "",
    ...ev.fileTree,
    ...ev.keyFiles.map((f) => f.content),
  ].join("\n");
}

/** Known identifiers that MUST have been removed, as boundary regexes. */
function knownIdentifierTerms(ctx: IdentityContext): { re: RegExp; label: string }[] {
  const terms: { re: RegExp; label: string }[] = [];
  const add = (t: string | null | undefined, label: string, minLen = 3) => {
    if (!t) return;
    const s = t.trim();
    if (s.length < minLen) return;
    terms.push({ re: new RegExp(`\\b${escapeRe(s)}\\b`, "i"), label });
  };
  add(ctx.ownerLogin, "repository owner identity");
  for (const m of ctx.memberNames ?? []) {
    add(m, "participant name");
    for (const tok of m.split(/\s+/)) add(tok, "participant name", 3);
  }
  add(ctx.university, "university name");
  add(ctx.teamName, "team name");
  return terms;
}

export function containsIdentityLeakage(
  evidence: RepoEvidence,
  ctx?: IdentityContext,
): LeakageResult {
  const reasons = new Set<string>();
  const text = collectText(evidence);

  // Owner field itself must be the neutral placeholder.
  if (evidence.owner && evidence.owner !== OWNER_PLACEHOLDER) {
    reasons.add("repository owner identity");
  }

  if (EMAIL_RE.test(text)) reasons.add("email address");
  if (MAILTO_RE.test(text)) reasons.add("email address");
  if (LINKEDIN_RE.test(text) || SOCIAL_RE.test(text)) reasons.add("personal profile URL");

  // GitHub profile URLs (bare github.com/<user>), ignoring the placeholder.
  for (const m of text.matchAll(GH_PROFILE_RE)) {
    if (m[1] && m[1] !== OWNER_PLACEHOLDER) {
      reasons.add("GitHub username / profile URL");
      break;
    }
  }

  // Residual known identifiers (redactor miss).
  if (ctx) {
    for (const { re, label } of knownIdentifierTerms(ctx)) {
      if (re.test(text)) reasons.add(label);
    }
  }

  return { leaked: reasons.size > 0, reasons: [...reasons] };
}

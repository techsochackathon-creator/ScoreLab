import type { Prisma, PrismaClient } from "@prisma/client";
import { getJudgeResults, type JudgeResults, type JudgeResultsDb } from "@/lib/judgeResults";
import { FINALIZED_MSG, JudgeServiceError, lockJudgingExclusive } from "@/lib/judges";

/**
 * Official competition results = JUDGE SCORE ONLY.
 *
 * Lifecycle (one ResultsPublication row, see prisma/schema.prisma):
 *   JUDGING OPEN  – no row. Results are computed live:
 *                   JudgeEvaluation.finalScore (SUBMITTED) → getJudgeResults() (Phase 4)
 *   FINALIZED     – finalizeResults() writes an immutable snapshot of those results.
 *                   Judge evaluations and assignments are locked (judges.ts).
 *   PUBLISHED     – publishedAt set; /leaderboard shows the SNAPSHOT, never live data.
 *
 * No scoring happens here — this file only labels, validates and freezes Phase 4
 * results. AI scores are never read. Public output carries no judge ids, judge
 * counts, individual judge scores, drafts, assignments or AI data.
 */

export type OfficialResultsDb = JudgeResultsDb & Pick<PrismaClient, "resultsPublication" | "$transaction">;

/** WINNER: unique highest. TIED_FIRST: shares the highest (no winner). RANKED: any other scored team. */
export type OfficialStatus = "WINNER" | "TIED_FIRST" | "RANKED" | "NOT_EVALUATED";

export function officialStatus(results: JudgeResults, teamId: string): OfficialStatus {
  if (results.winnerTeamId === teamId) return "WINNER";
  if (results.status === "TIE" && results.topTeamIds.includes(teamId)) return "TIED_FIRST";
  if (results.ranked.some((t) => t.teamId === teamId)) return "RANKED";
  return "NOT_EVALUATED";
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

export interface FinalSnapshotTeam {
  teamId: string;
  teamCode: string;
  teamName: string;
  /** Official judge score, 2 dp. */
  judgeScore: number;
  rank: number;
  isWinner: boolean;
}

/** The authoritative final result. Stored once; never recomputed or updated. */
export interface FinalSnapshot {
  version: 1;
  winnerTeamId: string;
  /** Rank order. */
  teams: FinalSnapshotTeam[];
  /** Teams an organizer disqualified before finalizing: listed, never scored or ranked. No reason is stored. */
  disqualified?: { teamId: string; teamCode: string; teamName: string }[];
}

const joinCodes = (codes: string[]) =>
  codes.length <= 1 ? codes.join("") : `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;

export interface JudgingProgress {
  totalTeams: number;
  /** Teams with ≥ 1 submitted evaluation (these are "complete" for finalization). */
  withSubmitted: number;
  draftsOnly: number;
  noEvaluation: number;
  /** withSubmitted / totalTeams, whole percent. */
  percent: number;
  /** Teams still blocking finalization for lack of a submitted evaluation. */
  missing: { teamId: string; teamCode: string; name: string; draftJudges: number; assignedJudges: number }[];
}

/**
 * Overall judging progress for the organizer, derived from the same live
 * results that finalization validates — so "missing" is exactly the set of
 * teams finalizationBlockers() reports.
 */
export function judgingProgress(results: JudgeResults): JudgingProgress {
  const totalTeams = results.ranked.length + results.incomplete.length;
  const draftsOnly = results.incomplete.filter((t) => t.draftJudges > 0).length;
  return {
    totalTeams,
    withSubmitted: results.ranked.length,
    draftsOnly,
    noEvaluation: results.incomplete.length - draftsOnly,
    percent: totalTeams ? Math.round((results.ranked.length / totalTeams) * 100) : 0,
    missing: results.incomplete.map((t) => ({
      teamId: t.teamId,
      teamCode: t.teamCode,
      name: t.name,
      draftJudges: t.draftJudges,
      assignedJudges: t.assignedJudges,
    })),
  };
}

/**
 * Why the current live results cannot be finalized ([] = ready). Every Team is
 * required (the app has no inactive-team concept). Drafts never count.
 */
export function finalizationBlockers(results: JudgeResults): string[] {
  if (results.ranked.length + results.incomplete.length === 0) return ["Cannot finalize: there are no teams."];
  const blockers: string[] = [];
  const draftsOnly = results.incomplete.filter((t) => t.draftJudges > 0).map((t) => t.teamCode);
  const none = results.incomplete.filter((t) => t.draftJudges === 0).map((t) => t.teamCode);
  if (none.length) blockers.push(`Cannot finalize: ${joinCodes(none)} ${none.length === 1 ? "has" : "have"} no submitted evaluation.`);
  if (draftsOnly.length) {
    blockers.push(`Cannot finalize: ${joinCodes(draftsOnly)} ${draftsOnly.length === 1 ? "has" : "have"} only draft evaluations.`);
  }
  if (results.status === "TIE") {
    const tied = results.ranked.filter((t) => results.topTeamIds.includes(t.teamId));
    blockers.push(`Cannot finalize: ${joinCodes(tied.map((t) => t.teamCode))} are tied at ${tied[0].judgeScore!.toFixed(2)}.`);
  }
  return blockers;
}

/** Build the snapshot from complete, untied live results. */
export function buildFinalSnapshot(results: JudgeResults): FinalSnapshot {
  if (results.status !== "WINNER" || !results.winnerTeamId || results.incomplete.length > 0) {
    throw new Error("buildFinalSnapshot requires complete results with a unique winner");
  }
  return {
    version: 1,
    winnerTeamId: results.winnerTeamId,
    teams: results.ranked.map((t) => ({
      teamId: t.teamId,
      teamCode: t.teamCode,
      teamName: t.name,
      judgeScore: t.judgeScore!,
      rank: t.rank!,
      isWinner: t.teamId === results.winnerTeamId,
    })),
    disqualified: results.disqualified.map((t) => ({ teamId: t.teamId, teamCode: t.teamCode, teamName: t.name })),
  };
}

export interface OfficialState {
  finalizedAt: Date;
  finalizedById: string;
  publishedAt: Date | null;
  snapshot: FinalSnapshot;
}

export async function getOfficialState(db: Pick<PrismaClient, "resultsPublication">): Promise<OfficialState | null> {
  const row = await db.resultsPublication.findFirst({
    select: { finalizedAt: true, finalizedById: true, publishedAt: true, snapshot: true },
  });
  return row && { ...row, snapshot: row.snapshot as unknown as FinalSnapshot };
}

/**
 * Freeze the official result. Refused (409) if already finalized, or (400) with
 * every blocker if any team lacks a submitted evaluation or the top score is tied.
 *
 * Atomic: one transaction takes the EXCLUSIVE judging lock, then re-checks,
 * reads the live results, validates and inserts the snapshot. Every write that
 * could change those results (judge evaluations, assignments, teams) runs under
 * the SHARED lock plus a "not finalized" guard (judges.ts whileJudgingOpen), so it
 * either committed before this read — and is in the snapshot — or runs after
 * this commit and is rejected. Any error or timeout rolls everything back.
 */
export async function finalizeResults(db: OfficialResultsDb, organizerId: string): Promise<OfficialState> {
  if (await getOfficialState(db)) throw new JudgeServiceError(409, FINALIZED_MSG); // fast path

  await db.$transaction(
    async (tx) => {
      await lockJudgingExclusive(tx);
      if (await tx.resultsPublication.findFirst({ select: { id: true } })) throw new JudgeServiceError(409, FINALIZED_MSG);

      const results = await getJudgeResults(tx);
      const blockers = finalizationBlockers(results);
      if (blockers.length) throw new JudgeServiceError(400, blockers.join(" "));

      await tx.resultsPublication.create({
        data: {
          slot: "OFFICIAL",
          finalizedById: organizerId,
          snapshot: buildFinalSnapshot(results) as unknown as Prisma.InputJsonValue,
        },
      });
    },
    // Rare organizer action on a remote DB: allow slow round trips. On timeout it rolls back and can be retried.
    { timeout: 30_000, maxWait: 15_000 },
  );
  return (await getOfficialState(db))!;
}

// ---------------------------------------------------------------------------
// Public projection (from the snapshot only)
// ---------------------------------------------------------------------------

export interface PublicResultRow {
  rank: number;
  teamCode: string;
  teamName: string;
  judgeScore: number;
  status: "WINNER" | "RANKED";
}

export interface PublicResults {
  winner: { teamCode: string; teamName: string; judgeScore: number };
  rows: PublicResultRow[];
  /** Disqualified teams: name and code only — no score, no rank, no reason. */
  disqualified: { teamCode: string; teamName: string }[];
}

/** Public view of the final snapshot — rank, team code/name, score, winner flag. Nothing else. */
export function toPublicResults(snapshot: FinalSnapshot): PublicResults {
  const rows: PublicResultRow[] = snapshot.teams.map((t) => ({
    rank: t.rank,
    teamCode: t.teamCode,
    teamName: t.teamName,
    judgeScore: t.judgeScore,
    status: t.isWinner ? "WINNER" : "RANKED",
  }));
  const w = snapshot.teams.find((t) => t.isWinner)!;
  return {
    winner: { teamCode: w.teamCode, teamName: w.teamName, judgeScore: w.judgeScore },
    rows,
    disqualified: (snapshot.disqualified ?? []).map((t) => ({ teamCode: t.teamCode, teamName: t.teamName })),
  };
}

/** Public results from the snapshot, or `{ published: false }` until finalized AND published. */
export async function getPublicResults(
  db: Pick<PrismaClient, "resultsPublication">,
): Promise<{ published: false } | ({ published: true; publishedAt: Date } & PublicResults)> {
  const state = await getOfficialState(db);
  if (!state?.publishedAt) return { published: false };
  return { published: true, publishedAt: state.publishedAt, ...toPublicResults(state.snapshot) };
}

// ---------------------------------------------------------------------------
// Publication (separate from finalization; never touches the snapshot)
// ---------------------------------------------------------------------------

export async function publishResults(db: Pick<PrismaClient, "resultsPublication">, organizerId: string) {
  const state = await getOfficialState(db);
  if (!state) throw new JudgeServiceError(409, "Cannot publish results before judging has been finalized.");
  if (state.publishedAt) return; // already published — idempotent
  await db.resultsPublication.updateMany({
    where: { slot: "OFFICIAL", publishedAt: null },
    data: { publishedAt: new Date(), publishedById: organizerId },
  });
}

/** Hide the public leaderboard again. The finalized snapshot is unchanged. */
export async function unpublishResults(db: Pick<PrismaClient, "resultsPublication">) {
  await db.resultsPublication.updateMany({ where: { slot: "OFFICIAL" }, data: { publishedAt: null, publishedById: null } });
}

/**
 * Reopen judging: delete the finalized official result (and with it the
 * publication), so judging is open again. ONLY the ResultsPublication row is
 * removed — judge evaluations, assignments, teams and the rubric are untouched,
 * and SUBMITTED evaluations stay locked. Serialized against finalization and
 * every guarded write by the same exclusive lock. 409 if nothing is finalized.
 */
export async function reopenJudging(db: Pick<PrismaClient, "$transaction" | "resultsPublication">) {
  await db.$transaction(
    async (tx) => {
      await lockJudgingExclusive(tx);
      const { count } = await tx.resultsPublication.deleteMany({});
      if (count === 0) throw new JudgeServiceError(409, "Judging is not finalized, so there is nothing to reopen.");
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
}

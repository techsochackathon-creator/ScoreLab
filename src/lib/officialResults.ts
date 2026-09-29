import type { PrismaClient } from "@prisma/client";
import { getJudgeResults, type JudgeResults, type JudgeResultsDb } from "@/lib/judgeResults";
import { JudgeServiceError } from "@/lib/judges";

/**
 * Official competition results = JUDGE SCORE ONLY.
 *
 *   JudgeEvaluation.finalScore (SUBMITTED only)
 *     → getJudgeResults()  (Phase 4: average, 2 dp, rank, tie groups, winner)
 *     → official status per team (this file)
 *     → organizer view / public projection
 *
 * No scoring happens here — this file only labels and filters Phase 4 results.
 * AI scores are never read. The public projection carries no judge ids, judge
 * counts, drafts, assignments or AI data, and exists only while an organizer
 * has published the results.
 */

export type OfficialResultsDb = JudgeResultsDb & Pick<PrismaClient, "resultsPublication">;

/** WINNER: unique highest. TIED_FIRST: shares the highest (no winner). RANKED: any other scored team. */
export type OfficialStatus = "WINNER" | "TIED_FIRST" | "RANKED" | "NOT_EVALUATED";

export function officialStatus(results: JudgeResults, teamId: string): OfficialStatus {
  if (results.winnerTeamId === teamId) return "WINNER";
  if (results.status === "TIE" && results.topTeamIds.includes(teamId)) return "TIED_FIRST";
  if (results.ranked.some((t) => t.teamId === teamId)) return "RANKED";
  return "NOT_EVALUATED";
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

export interface PublicResultRow {
  rank: number;
  teamCode: string;
  teamName: string;
  judgeScore: number;
  status: Exclude<OfficialStatus, "NOT_EVALUATED">;
}

export interface PublicResults {
  /** WINNER, TIE (winner determination pending) or NO_RESULTS. */
  status: JudgeResults["status"];
  winner: { teamCode: string; teamName: string; judgeScore: number } | null;
  /** Teams sharing the highest score when status is TIE. */
  tiedForFirst: { teamCode: string; teamName: string; judgeScore: number }[];
  rows: PublicResultRow[];
  notEvaluated: { teamCode: string; teamName: string }[];
}

/** Strip everything that is not appropriate for the public page. */
export function toPublicResults(results: JudgeResults): PublicResults {
  const rows: PublicResultRow[] = results.ranked.map((t) => ({
    rank: t.rank!,
    teamCode: t.teamCode,
    teamName: t.name,
    judgeScore: t.judgeScore!,
    status: officialStatus(results, t.teamId) as PublicResultRow["status"],
  }));
  const winnerRow = rows.find((r) => r.status === "WINNER") ?? null;
  return {
    status: results.status,
    winner: winnerRow && { teamCode: winnerRow.teamCode, teamName: winnerRow.teamName, judgeScore: winnerRow.judgeScore },
    tiedForFirst: rows
      .filter((r) => r.status === "TIED_FIRST")
      .map((r) => ({ teamCode: r.teamCode, teamName: r.teamName, judgeScore: r.judgeScore })),
    rows,
    notEvaluated: results.incomplete.map((t) => ({ teamCode: t.teamCode, teamName: t.name })),
  };
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

export async function getPublication(db: Pick<PrismaClient, "resultsPublication">) {
  return db.resultsPublication.findFirst({ select: { publishedAt: true } });
}

/** Public results, or `{ published: false }` until an organizer publishes. */
export async function getPublicResults(
  db: OfficialResultsDb,
): Promise<{ published: false } | ({ published: true; publishedAt: Date } & PublicResults)> {
  const publication = await getPublication(db);
  if (!publication) return { published: false };
  return { published: true, publishedAt: publication.publishedAt, ...toPublicResults(await getJudgeResults(db)) };
}

/** Make the official results public. Idempotent. Refused while nobody has submitted. */
export async function publishResults(db: OfficialResultsDb, organizerId: string) {
  const results = await getJudgeResults(db);
  if (results.status === "NO_RESULTS") throw new JudgeServiceError(409, "No submitted judge evaluations to publish yet");
  await db.resultsPublication.upsert({
    where: { slot: "OFFICIAL" },
    create: { slot: "OFFICIAL", publishedById: organizerId },
    update: {},
  });
}

export async function unpublishResults(db: Pick<PrismaClient, "resultsPublication">) {
  await db.resultsPublication.deleteMany({});
}

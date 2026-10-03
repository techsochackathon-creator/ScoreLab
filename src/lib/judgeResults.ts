import type { PrismaClient } from "@prisma/client";

/**
 * Official judge results (organizer only).
 *
 * Official score = arithmetic mean of the team's SUBMITTED JudgeEvaluation.finalScore
 * values (each judge counted once, equal weight). Drafts never count. AI scores
 * are not read here at all — they are not blended, weighted or used to break ties.
 *
 * Rounding: scores are handled as integer hundredths ("cents"). Each stored
 * finalScore is already 2 dp (Phase 3); the mean is rounded half-up to 2 dp
 * (87.505 → 87.51, 87.504 → 87.50). Ties are exact integer comparisons of
 * those rounded values, so there is no floating-point equality anywhere.
 *
 * Winner: the team with the unique highest official score, automatically.
 * If the highest score is shared, the result is a TIE and there is no winner —
 * nothing (AI score, team id, name, random) is used to pick one.
 *
 * Disqualified teams (Team.disqualifiedAt) are set aside BEFORE any ranking:
 * they get no score or rank, cannot win or tie, and are not required for
 * finalization. They are listed separately in `disqualified`.
 */

export type JudgeResultsDb = Pick<PrismaClient, "team" | "judgeEvaluation" | "judgeAssignment">;

export interface TeamResult {
  teamId: string;
  teamCode: string;
  name: string;
  projectTitle: string | null;
  /** Official judge score, 2 dp; null when no judge has submitted. */
  judgeScore: number | null;
  submittedJudges: number;
  draftJudges: number;
  assignedJudges: number;
  /** Competition rank (1, 1, 3…) among complete teams; null when incomplete. */
  rank: number | null;
  /** Other teams with exactly the same official score. */
  tiedWith: string[];
}

export interface DisqualifiedTeam {
  teamId: string;
  teamCode: string;
  name: string;
  /** Organizer-only explanation. */
  reason: string | null;
}

export interface TieGroup {
  rank: number;
  judgeScore: number;
  teamIds: string[];
}

/** NO_RESULTS: nobody has submitted. WINNER: unique highest score. TIE: highest score shared. */
export type ResultsStatus = "NO_RESULTS" | "WINNER" | "TIE";

export interface JudgeResults {
  status: ResultsStatus;
  /** Set only when status is WINNER. */
  winnerTeamId: string | null;
  /** Team ids sharing the highest score (one id when there is a winner). */
  topTeamIds: string[];
  /** Complete teams, best first (ties share a rank; display order within a tie is by team code only). */
  ranked: TeamResult[];
  /** Teams with no submitted evaluation — never ranked. */
  incomplete: TeamResult[];
  /** Every group of teams sharing a score, at any rank. */
  ties: TieGroup[];
  /** Teams excluded from the ranking by an organizer. */
  disqualified: DisqualifiedTeam[];
}

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

/** A 2-dp score as integer hundredths. */
export const toCents = (score: number) => Math.round(score * 100);

/** Mean of integer-hundredths values, rounded half-up to a whole hundredth. */
export function meanCents(values: number[]): number | null {
  if (values.length === 0) return null;
  // sum/n of integers: an exact .5 is exactly representable, so Math.round is a true half-up.
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Official judge score (2 dp) from submitted judge final scores. */
export function officialJudgeScore(finalScores: number[]): number | null {
  const cents = meanCents(finalScores.map(toCents));
  return cents === null ? null : cents / 100;
}

export interface ResultsInput {
  teams: {
    id: string;
    teamCode: string;
    name: string;
    projectTitle: string | null;
    /** Set when disqualified; omitted/null for ordinary teams. */
    disqualifiedAt?: Date | null;
    disqualifiedReason?: string | null;
  }[];
  evaluations: { teamId: string; judgeId: string; status: string; finalScore: number | null }[];
  assignments: { teamId: string; judgeId: string }[];
}

export function buildJudgeResults({ teams: allTeams, evaluations, assignments }: ResultsInput): JudgeResults {
  const teams = allTeams.filter((t) => !t.disqualifiedAt);
  const disqualified: DisqualifiedTeam[] = allTeams
    .filter((t) => t.disqualifiedAt)
    .map((t) => ({ teamId: t.id, teamCode: t.teamCode, name: t.name, reason: t.disqualifiedReason ?? null }))
    .sort((a, b) => a.teamCode.localeCompare(b.teamCode));

  const submittedByTeam = new Map<string, Map<string, number>>(); // teamId → judgeId → cents
  const draftsByTeam = new Map<string, Set<string>>();
  for (const e of evaluations) {
    if (e.status === "SUBMITTED" && e.finalScore !== null) {
      const perJudge = submittedByTeam.get(e.teamId) ?? new Map<string, number>();
      if (!perJudge.has(e.judgeId)) perJudge.set(e.judgeId, toCents(e.finalScore)); // a judge counts once
      submittedByTeam.set(e.teamId, perJudge);
    } else if (e.status === "DRAFT") {
      draftsByTeam.set(e.teamId, (draftsByTeam.get(e.teamId) ?? new Set()).add(e.judgeId));
    }
  }
  const assignedByTeam = new Map<string, Set<string>>();
  for (const a of assignments) assignedByTeam.set(a.teamId, (assignedByTeam.get(a.teamId) ?? new Set()).add(a.judgeId));

  const rows = teams.map((t) => {
    const cents = meanCents([...(submittedByTeam.get(t.id)?.values() ?? [])]);
    return {
      cents,
      result: {
        teamId: t.id,
        teamCode: t.teamCode,
        name: t.name,
        projectTitle: t.projectTitle,
        judgeScore: cents === null ? null : cents / 100,
        submittedJudges: submittedByTeam.get(t.id)?.size ?? 0,
        draftJudges: draftsByTeam.get(t.id)?.size ?? 0,
        assignedJudges: assignedByTeam.get(t.id)?.size ?? 0,
        rank: null as number | null,
        tiedWith: [] as string[],
      },
    };
  });

  const complete = rows
    .filter((r): r is typeof r & { cents: number } => r.cents !== null)
    .sort((a, b) => b.cents - a.cents || a.result.teamCode.localeCompare(b.result.teamCode));

  const byCents = new Map<number, TeamResult[]>();
  for (const r of complete) byCents.set(r.cents, [...(byCents.get(r.cents) ?? []), r.result]);

  let higher = 0;
  const ties: TieGroup[] = [];
  for (const [cents, group] of [...byCents.entries()].sort((a, b) => b[0] - a[0])) {
    const rank = higher + 1;
    for (const t of group) {
      t.rank = rank;
      t.tiedWith = group.filter((o) => o !== t).map((o) => o.teamId);
    }
    if (group.length > 1) ties.push({ rank, judgeScore: cents / 100, teamIds: group.map((t) => t.teamId) });
    higher += group.length;
  }

  const ranked = complete.map((r) => r.result);
  const incomplete = rows.filter((r) => r.cents === null).map((r) => r.result);
  const topTeamIds = ranked.filter((t) => t.rank === 1).map((t) => t.teamId);
  const status: ResultsStatus = topTeamIds.length === 0 ? "NO_RESULTS" : topTeamIds.length === 1 ? "WINNER" : "TIE";

  return {
    status,
    winnerTeamId: status === "WINNER" ? topTeamIds[0] : null,
    topTeamIds,
    ranked,
    incomplete,
    ties,
    disqualified,
  };
}

// ---------------------------------------------------------------------------
// DB wrapper
// ---------------------------------------------------------------------------

/** Always computed from the database — nothing client-supplied is used. */
export async function getJudgeResults(db: JudgeResultsDb): Promise<JudgeResults> {
  const [teams, evaluations, assignments] = await Promise.all([
    db.team.findMany({
      select: { id: true, teamCode: true, name: true, projectTitle: true, disqualifiedAt: true, disqualifiedReason: true },
      orderBy: { teamCode: "asc" },
    }),
    db.judgeEvaluation.findMany({ select: { teamId: true, judgeId: true, status: true, finalScore: true } }),
    db.judgeAssignment.findMany({ select: { teamId: true, judgeId: true } }),
  ]);
  return buildJudgeResults({ teams, evaluations, assignments });
}

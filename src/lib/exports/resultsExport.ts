import type { PrismaClient } from "@prisma/client";
import writeXlsxFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { getJudgeResults, type JudgeResults } from "@/lib/judgeResults";
import { getOfficialState, officialStatus, type OfficialState } from "@/lib/officialResults";
import { toCsv } from "@/lib/exports/csv";

/**
 * Results export (organizer only). NO scoring happens here:
 *   - finalized → ranks, official scores and winner come from the frozen snapshot
 *   - judging open → they come from getJudgeResults() (the Phase 4 aggregation),
 *     and every row is labelled provisional
 * Individual judge scores are the stored JudgeEvaluation.finalScore of SUBMITTED
 * evaluations only (drafts excluded); the official score is their arithmetic mean
 * as computed by the existing aggregation. AI scores are never read.
 */

export interface JudgeScore { judge: string; score: number }

export interface RankingRow {
  rank: number | null;
  teamCode: string;
  teamName: string;
  projectTitle: string | null;
  officialScore: number | null;
  submittedEvaluations: number;
  judgeScores: JudgeScore[];
  status: string;
}

export interface JudgeScoreRow {
  teamCode: string;
  teamName: string;
  judge: string;
  score: number;
  submittedAt: Date | null;
  countsTowardOfficialScore: boolean;
}

export interface ResultsExport {
  resultType: "Final" | "Provisional (judging open)";
  rankings: RankingRow[];
  judgeScores: JudgeScoreRow[];
}

export interface SubmittedEvaluation {
  teamId: string;
  judge: string;
  finalScore: number;
  submittedAt: Date | null;
}

export interface ResultsExportInput {
  /** Finalized snapshot, if any — takes precedence. */
  state: OfficialState | null;
  /** Live aggregation (used only when not finalized). */
  live: JudgeResults | null;
  teams: { id: string; teamCode: string; name: string; projectTitle: string | null }[];
  /** SUBMITTED evaluations only. */
  evaluations: SubmittedEvaluation[];
}

const LIVE_STATUS = {
  WINNER: "Leader (provisional)",
  TIED_FIRST: "Tied for 1st (provisional)",
  RANKED: "Ranked (provisional)",
  NOT_EVALUATED: "Not evaluated",
} as const;

export function buildResultsExport({ state, live, teams, evaluations }: ResultsExportInput): ResultsExport {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const byTeam = new Map<string, JudgeScore[]>();
  for (const e of evaluations) byTeam.set(e.teamId, [...(byTeam.get(e.teamId) ?? []), { judge: e.judge, score: e.finalScore }]);
  for (const list of byTeam.values()) list.sort((a, b) => a.judge.localeCompare(b.judge));
  const scoresOf = (teamId: string) => byTeam.get(teamId) ?? [];

  const rankings: RankingRow[] = [];
  const official = new Set<string>(); // teams whose evaluations count toward an official score

  if (state) {
    for (const t of state.snapshot.teams) {
      official.add(t.teamId);
      rankings.push({
        rank: t.rank, teamCode: t.teamCode, teamName: t.teamName, projectTitle: teamById.get(t.teamId)?.projectTitle ?? null,
        officialScore: t.judgeScore, submittedEvaluations: scoresOf(t.teamId).length, judgeScores: scoresOf(t.teamId),
        status: t.isWinner ? "Winner" : "Ranked",
      });
    }
    for (const t of state.snapshot.disqualified ?? []) {
      rankings.push({
        rank: null, teamCode: t.teamCode, teamName: t.teamName, projectTitle: teamById.get(t.teamId)?.projectTitle ?? null,
        officialScore: null, submittedEvaluations: scoresOf(t.teamId).length, judgeScores: scoresOf(t.teamId), status: "Disqualified",
      });
    }
  } else if (live) {
    for (const t of [...live.ranked, ...live.incomplete]) {
      if (t.judgeScore !== null) official.add(t.teamId);
      rankings.push({
        rank: t.rank, teamCode: t.teamCode, teamName: t.name, projectTitle: t.projectTitle,
        officialScore: t.judgeScore, submittedEvaluations: t.submittedJudges, judgeScores: scoresOf(t.teamId),
        status: LIVE_STATUS[officialStatus(live, t.teamId)],
      });
    }
    for (const t of live.disqualified) {
      rankings.push({
        rank: null, teamCode: t.teamCode, teamName: t.name, projectTitle: teamById.get(t.teamId)?.projectTitle ?? null,
        officialScore: null, submittedEvaluations: scoresOf(t.teamId).length, judgeScores: scoresOf(t.teamId), status: "Disqualified",
      });
    }
  }

  const judgeScores: JudgeScoreRow[] = evaluations
    .filter((e) => teamById.has(e.teamId))
    .map((e) => {
      const t = teamById.get(e.teamId)!;
      return { teamCode: t.teamCode, teamName: t.name, judge: e.judge, score: e.finalScore, submittedAt: e.submittedAt, countsTowardOfficialScore: official.has(e.teamId) };
    })
    .sort((a, b) => a.teamCode.localeCompare(b.teamCode) || a.judge.localeCompare(b.judge));

  return { resultType: state ? "Final" : "Provisional (judging open)", rankings, judgeScores };
}

/** Load everything the export needs, using the existing result services. */
export async function getResultsExportData(
  db: Pick<PrismaClient, "team" | "judgeEvaluation" | "judgeAssignment" | "resultsPublication">,
): Promise<ResultsExport> {
  const state = await getOfficialState(db);
  const [live, teams, evals] = await Promise.all([
    state ? Promise.resolve(null) : getJudgeResults(db),
    db.team.findMany({ select: { id: true, teamCode: true, name: true, projectTitle: true } }),
    db.judgeEvaluation.findMany({
      where: { status: "SUBMITTED", finalScore: { not: null } },
      select: { teamId: true, finalScore: true, submittedAt: true, judge: { select: { name: true, email: true } } },
    }),
  ]);
  return buildResultsExport({
    state,
    live,
    teams,
    evaluations: evals.map((e) => ({ teamId: e.teamId, judge: e.judge.name || e.judge.email, finalScore: e.finalScore!, submittedAt: e.submittedAt })),
  });
}

const fmt2 = (n: number) => n.toFixed(2);
const judgeList = (s: JudgeScore[]) => s.map((j) => `${j.judge}: ${fmt2(j.score)}`).join("; ");

export const RESULT_HEADERS = [
  "Rank", "Team ID", "Team Name", "Project Name", "Official Final Score", "Submitted Judge Evaluations",
  "Individual Judge Scores", "Status", "Result Type",
];

export function resultsToCsv(r: ResultsExport): string {
  return toCsv(
    RESULT_HEADERS,
    r.rankings.map((x) => [
      x.rank, x.teamCode, x.teamName, x.projectTitle, x.officialScore === null ? null : fmt2(x.officialScore),
      x.submittedEvaluations, judgeList(x.judgeScores) || null, x.status, r.resultType,
    ]),
  );
}

const header = (labels: string[]) => labels.map((value) => ({ value, fontWeight: "bold" as const }));
const text = (s: string | null | undefined) => (s ? { value: s, type: String } : null);
const num = (n: number | null, format?: string) => (n === null ? null : { value: n, type: Number, ...(format ? { format } : {}) });

/** Workbook: "Final Rankings" and "Individual Judge Scores". Scores are numeric cells. */
export async function resultsToXlsx(r: ResultsExport): Promise<Buffer> {
  const rankings: SheetData = [
    header(RESULT_HEADERS),
    ...r.rankings.map((x) => [
      num(x.rank), text(x.teamCode), text(x.teamName), text(x.projectTitle), num(x.officialScore, "0.00"),
      num(x.submittedEvaluations), text(judgeList(x.judgeScores)), text(x.status), text(r.resultType),
    ]),
  ];
  const scores: SheetData = [
    header(["Team ID", "Team Name", "Judge", "Judge Final Score", "Submitted At (UTC)", "Counts Toward Official Score"]),
    ...r.judgeScores.map((s) => [
      text(s.teamCode), text(s.teamName), text(s.judge), num(s.score, "0.00"),
      s.submittedAt ? { value: s.submittedAt, type: Date, format: "yyyy-mm-dd hh:mm" } : null,
      text(s.countsTowardOfficialScore ? "Yes" : "No"),
    ]),
  ];
  return writeXlsxFile([
    { data: rankings, sheet: "Final Rankings", stickyRowsCount: 1, columns: [{ width: 7 }, { width: 14 }, { width: 26 }, { width: 26 }, { width: 12 }, { width: 12 }, { width: 46 }, { width: 24 }, { width: 24 }] },
    { data: scores, sheet: "Individual Judge Scores", stickyRowsCount: 1, columns: [{ width: 14 }, { width: 26 }, { width: 26 }, { width: 12 }, { width: 20 }, { width: 14 }] },
  ]).toBuffer();
}


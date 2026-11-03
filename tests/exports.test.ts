/**
 * CSV / Excel exports for Teams and Results.
 * Excel files are unzipped (fflate, the library's own dependency) and their XML inspected.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { csvField, toCsv } from "../src/lib/exports/csv";
import { teamsToCsv, teamsToXlsx, TEAM_HEADERS, type TeamExportRow } from "../src/lib/exports/teamsExport";
import { buildResultsExport, getResultsExportData, resultsToCsv, resultsToXlsx, RESULT_HEADERS } from "../src/lib/exports/resultsExport";
import { buildJudgeResults, officialJudgeScore, type ResultsInput } from "../src/lib/judgeResults";
import { buildFinalSnapshot, type OfficialState } from "../src/lib/officialResults";

// ---------- helpers ----------
const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
function xlsx(buf: Buffer) {
  const files = unzipSync(new Uint8Array(buf));
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : "");
  const sheetNames = [...read("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
  const sheetFiles = Object.keys(files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort();
  const sheets = sheetFiles.map((p) => read(p));
  return { files, read, sheetNames, shared, sheets };
}
/** Values of numeric cells (cells without a t="s"/"inlineStr" type) in a sheet's XML. */
const numericCells = (sheetXml: string) =>
  [...sheetXml.matchAll(/<c ([^>]*)>(?:<f>[^<]*<\/f>)?<v>([^<]*)<\/v><\/c>/g)].filter((m) => !/\bt="/.test(m[1])).map((m) => Number(m[2]));

const team = (o: Partial<TeamExportRow> = {}): TeamExportRow => ({
  teamCode: "T01", name: "Rockets", projectTitle: "Moonshot", memberNames: ["Ada", "Alan"], repoUrl: "https://github.com/r/m",
  university: "FAST", track: "AI/ML", status: "Active", disqualifiedReason: null, createdAt: new Date("2026-10-02T18:04:47Z"), ...o,
});

// ---------- CSV writer ----------
describe("CSV writer", () => {
  it("quotes commas, quotes and newlines; doubles quotes; empty for null", () => {
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("line1\nline2"), '"line1\nline2"');
    assert.equal(csvField(null), "");
    assert.equal(csvField(undefined), "");
    assert.equal(csvField(85.5), "85.5");
  });

  it("guards text that a spreadsheet would run as a formula; numbers are untouched", () => {
    assert.equal(csvField("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvField("+1"), "'+1");
    assert.equal(csvField("-cmd"), "'-cmd");
    assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvField(-5), "-5");
  });

  it("starts with a UTF-8 BOM and uses CRLF line endings", () => {
    const csv = toCsv(["A", "B"], [["x", 1]]);
    assert.ok(csv.startsWith("﻿A,B\r\nx,1\r\n"));
  });
});

// ---------- Teams ----------
describe("Teams export", () => {
  it("CSV: header + one row per team, members joined, status and date", () => {
    const out = lines(teamsToCsv([team()]));
    assert.equal(out[0], TEAM_HEADERS.join(","));
    assert.equal(out[1], "T01,Rockets,Moonshot,Ada; Alan,2,https://github.com/r/m,FAST,AI/ML,Active,,2026-10-02 18:04");
  });

  it("CSV: missing optional fields become empty cells, not 'null'", () => {
    const out = lines(teamsToCsv([team({ projectTitle: null, memberNames: [], repoUrl: null, university: "", track: "" })]));
    assert.equal(out[1], "T01,Rockets,,,0,,,,Active,,2026-10-02 18:04");
    assert.ok(!out[1].includes("null") && !out[1].includes("undefined"));
  });

  it("CSV: disqualified teams carry their status and reason", () => {
    const out = lines(teamsToCsv([team({ status: "Disqualified", disqualifiedReason: "Plagiarism, confirmed" })]));
    assert.match(out[1], /,Disqualified,"Plagiarism, confirmed",/);
  });

  it("CSV: zero teams → just the header row", () => {
    assert.deepEqual(lines(teamsToCsv([])), [TEAM_HEADERS.join(",")]);
  });

  it("Excel: sheets 'Teams' and 'Team Members', text as strings, member count and date as numbers", async () => {
    const wb = xlsx(await teamsToXlsx([team(), team({ teamCode: "T02", name: "=evil()", memberNames: [] })]));
    assert.deepEqual(wb.sheetNames, ["Teams", "Team Members"]);
    for (const h of TEAM_HEADERS) assert.ok(wb.shared.includes(h), `header ${h}`);
    assert.ok(wb.shared.includes("=evil()"), "user text is stored as a string, never as a formula");
    assert.ok(!/<f>/.test(wb.sheets.join("")), "no formula cells");
    const nums = numericCells(wb.sheets[0]);
    assert.ok(nums.includes(2) && nums.includes(0), "member counts are numeric");
    assert.ok(nums.some((n) => n > 46000 && n < 47000), "registration date is an Excel date serial");
    // Team Members sheet: one row per member (2 for T01, none for T02)
    assert.equal((wb.sheets[1].match(/<row /g) ?? []).length, 3);
  });

  it("Excel: zero teams still produces a valid workbook with headers", async () => {
    const wb = xlsx(await teamsToXlsx([]));
    assert.deepEqual(wb.sheetNames, ["Teams", "Team Members"]);
    assert.ok(wb.files["[Content_Types].xml"]);
  });
});

// ---------- Results ----------
type Team = ResultsInput["teams"][number];
const T = (id: string, extra: Partial<Team> = {}): Team => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: `Project ${id}`, ...extra });
const sub = (teamId: string, judgeId: string, finalScore: number) => ({ teamId, judgeId, status: "SUBMITTED", finalScore });
const draft = (teamId: string, judgeId: string) => ({ teamId, judgeId, status: "DRAFT", finalScore: null });
const judgeName = (id: string) => `Judge ${id.toUpperCase()}`;

function liveExport(teams: Team[], evaluations: ResultsInput["evaluations"]) {
  const live = buildJudgeResults({ teams, evaluations, assignments: [] });
  const submitted = evaluations
    .filter((e) => e.status === "SUBMITTED" && e.finalScore !== null)
    .map((e) => ({ teamId: e.teamId, judge: judgeName(e.judgeId), finalScore: e.finalScore!, submittedAt: new Date("2026-10-02T10:00:00Z") }));
  return { live, exp: buildResultsExport({ state: null, live, teams, evaluations: submitted }) };
}

describe("Results export — scoring integrity", () => {
  it("multiple judges on one team: official score = existing aggregation = mean of the exported judge scores", () => {
    const { live, exp } = liveExport([T("a"), T("b")], [sub("a", "j1", 80), sub("a", "j2", 90), sub("a", "j3", 85.5), sub("b", "j1", 70)]);
    const a = exp.rankings.find((r) => r.teamCode === "A")!;
    assert.equal(a.officialScore, live.ranked.find((t) => t.teamId === "a")!.judgeScore, "same number the Results page shows");
    assert.equal(a.officialScore, officialJudgeScore(a.judgeScores.map((j) => j.score)), "arithmetic mean of the listed judge scores");
    assert.equal(a.officialScore, 85.17);
    assert.equal(a.submittedEvaluations, 3);
    assert.deepEqual(a.judgeScores.map((j) => j.judge), ["Judge J1", "Judge J2", "Judge J3"]);
  });

  it("drafts are ignored: not counted, not listed, no effect on the score", () => {
    const { exp } = liveExport([T("a"), T("b")], [sub("a", "j1", 80), draft("a", "j2"), draft("b", "j1")]);
    const a = exp.rankings.find((r) => r.teamCode === "A")!;
    const b = exp.rankings.find((r) => r.teamCode === "B")!;
    assert.deepEqual([a.officialScore, a.submittedEvaluations, a.judgeScores.length], [80, 1, 1]);
    assert.deepEqual([b.officialScore, b.submittedEvaluations, b.status, b.rank], [null, 0, "Not evaluated", null]);
    assert.ok(exp.judgeScores.every((s) => s.teamCode !== "B"));
  });

  it("while judging is open everything is labelled provisional; ranks and tie labels come from the aggregation", () => {
    const { exp } = liveExport([T("a"), T("b"), T("c")], [sub("a", "j1", 80), sub("b", "j1", 80), sub("c", "j1", 60)]);
    assert.equal(exp.resultType, "Provisional (judging open)");
    assert.deepEqual(exp.rankings.map((r) => [r.teamCode, r.rank, r.status]), [["A", 1, "Tied for 1st (provisional)"], ["B", 1, "Tied for 1st (provisional)"], ["C", 3, "Ranked (provisional)"]]);
  });

  it("after finalization the frozen snapshot is used — not live data", () => {
    const teams = [T("a"), T("b"), T("c", { disqualifiedAt: new Date(), disqualifiedReason: "x" })];
    const live = buildJudgeResults({ teams, evaluations: [sub("a", "j1", 90), sub("b", "j1", 80), sub("c", "j1", 99)], assignments: [] });
    const state: OfficialState = { finalizedAt: new Date(), finalizedById: "org", publishedAt: null, snapshot: buildFinalSnapshot(live) };
    // Pretend live judge data now says something else: the export must still show the snapshot's numbers.
    const exp = buildResultsExport({
      state, live: null, teams,
      evaluations: [{ teamId: "a", judge: "Judge J1", finalScore: 90, submittedAt: null }, { teamId: "b", judge: "Judge J1", finalScore: 80, submittedAt: null }, { teamId: "c", judge: "Judge J1", finalScore: 99, submittedAt: null }],
    });
    assert.equal(exp.resultType, "Final");
    assert.deepEqual(exp.rankings.map((r) => [r.teamCode, r.rank, r.officialScore, r.status]), [["A", 1, 90, "Winner"], ["B", 2, 80, "Ranked"], ["C", null, null, "Disqualified"]]);
    assert.equal(exp.rankings.filter((r) => r.status === "Winner").length, 1);
    const c = exp.judgeScores.find((s) => s.teamCode === "C")!;
    assert.equal(c.countsTowardOfficialScore, false, "disqualified team's evaluation is listed but marked as not counting");
    assert.ok(exp.judgeScores.filter((s) => s.teamCode !== "C").every((s) => s.countsTowardOfficialScore));
  });

  it("zero teams → empty rankings; CSV is just the header; workbook is valid", async () => {
    const exp = buildResultsExport({ state: null, live: buildJudgeResults({ teams: [], evaluations: [], assignments: [] }), teams: [], evaluations: [] });
    assert.deepEqual(exp.rankings, []);
    assert.deepEqual(lines(resultsToCsv(exp)), [RESULT_HEADERS.join(",")]);
    assert.deepEqual(xlsx(await resultsToXlsx(exp)).sheetNames, ["Final Rankings", "Individual Judge Scores"]);
  });
});

describe("Results export — files", () => {
  it("CSV: 2-decimal official score, judge list, status and result type", () => {
    const { exp } = liveExport([T("a")], [sub("a", "j1", 80), sub("a", "j2", 90)]);
    const out = lines(resultsToCsv(exp));
    assert.equal(out[0], RESULT_HEADERS.join(","));
    assert.equal(out[1], "1,A,Team a,Project a,85.00,2,Judge J1: 80.00; Judge J2: 90.00,Leader (provisional),Provisional (judging open)");
  });

  it("Excel: two sheets; official and judge scores are numeric cells", async () => {
    const { exp } = liveExport([T("a"), T("b")], [sub("a", "j1", 80), sub("a", "j2", 90), sub("b", "j1", 70.25)]);
    const wb = xlsx(await resultsToXlsx(exp));
    assert.deepEqual(wb.sheetNames, ["Final Rankings", "Individual Judge Scores"]);
    const rankNums = numericCells(wb.sheets[0]);
    assert.ok(rankNums.includes(85) && rankNums.includes(70.25), "official scores are numbers");
    const judgeNums = numericCells(wb.sheets[1]);
    for (const n of [80, 90, 70.25]) assert.ok(judgeNums.includes(n), `judge score ${n} is a number`);
    assert.ok(wb.read("xl/styles.xml").includes('formatCode="0.00"'), "scores display with 2 decimals");
  });
});

describe("Results export — data loading", () => {
  it("only SUBMITTED evaluations are loaded; judge names are used, email as fallback", async () => {
    const evaluations = [
      { teamId: "a", status: "SUBMITTED", finalScore: 80, submittedAt: new Date(), judge: { name: "Ann", email: "ann@x.io" } },
      { teamId: "a", status: "DRAFT", finalScore: null, submittedAt: null, judge: { name: "Bob", email: "bob@x.io" } },
      { teamId: "a", status: "SUBMITTED", finalScore: 90, submittedAt: new Date(), judge: { name: null, email: "cy@x.io" } },
    ];
    let lastWhere: unknown = null;
    const db = {
      team: { findMany: async () => [T("a")].map((t) => ({ ...t, disqualifiedAt: null, disqualifiedReason: null })) },
      judgeAssignment: { findMany: async () => [] },
      resultsPublication: { findFirst: async () => null },
      judgeEvaluation: {
        findMany: async (args: { where?: { status?: string } }) => {
          lastWhere = args.where;
          return evaluations
            .filter((e) => !args.where?.status || e.status === args.where.status)
            .map((e) => ({ teamId: e.teamId, judgeId: e.judge.email, status: e.status, finalScore: e.finalScore, submittedAt: e.submittedAt, judge: e.judge }));
        },
      },
    };
    const exp = await getResultsExportData(db as never);
    assert.ok(lastWhere !== null);
    const a = exp.rankings[0];
    assert.deepEqual(a.judgeScores.map((j) => j.judge), ["Ann", "cy@x.io"]);
    assert.equal(a.officialScore, 85);
    assert.equal(a.submittedEvaluations, 2);
    assert.ok(!exp.judgeScores.some((s) => s.judge === "Bob"));
  });
});

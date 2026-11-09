import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import writeXlsxFile from "write-excel-file/node";
import { readCsvRows } from "../src/lib/imports/csvReader";
import { readXlsxRows, XlsxReadError } from "../src/lib/imports/xlsxReader";
import { planTeamImport, type TeamImportOp } from "../src/lib/imports/teamImport";
import { teamsToXlsx } from "../src/lib/exports/teamsExport";

const plan = (rows: string[][], existing: { teamCode: string; name: string }[] = []) => {
  const p = planTeamImport(rows, existing);
  assert.ok(p.ok, p.ok ? "" : p.error);
  return p as { ok: true; ops: TeamImportOp[]; warnings: string[] };
};

describe("CSV reader", () => {
  it("strips Excel's BOM so the first header is recognized", () => {
    const rows = readCsvRows("﻿teamCode,name\r\nT1,Rockets\r\n");
    assert.deepEqual(rows, [["teamCode", "name"], ["T1", "Rockets"]]);
    assert.equal(plan(rows).ops[0].teamCode, "T1");
  });
  it("reads semicolon-delimited CSV (Excel in many locales)", () => {
    assert.deepEqual(readCsvRows('Team ID;Team Name\nT1;"Rock; ets"\n'), [["Team ID", "Team Name"], ["T1", "Rock; ets"]]);
  });
  it("keeps blank rows so row numbers match the spreadsheet", () => {
    const p = plan(readCsvRows("Team Name\n\nRockets\n"));
    assert.equal(p.ops[0].row, 3);
  });
});

describe("Excel reader", () => {
  it("reads a real .xlsx: shared strings, numbers as plain text, blanks in place", async () => {
    const buf = await writeXlsxFile([
      [{ value: "Team ID" }, { value: "Team Name" }, { value: "Members" }],
      [{ value: 101, type: Number }, { value: "Rockets & Co <1>" }, null],
      [{ value: "T2" }, null, { value: "Zoë; Łukasz" }],
    ]).toBuffer();
    assert.deepEqual(readXlsxRows(new Uint8Array(buf)), [
      ["Team ID", "Team Name", "Members"],
      ["101", "Rockets & Co <1>"],
      ["T2", "", "Zoë; Łukasz"],
    ]);
  });

  it("reads inline strings, booleans and gaps in columns", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Team Name</t></is></c><c r="C1" t="inlineStr"><is><r><t>Lead</t></r><r><t>er Email</t></r></is></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>Rockets</t></is></c><c r="B3" t="b"><v>1</v></c><c r="C3" t="str"><v>a@b.co</v></c></row>
    </sheetData></worksheet>`;
    const bytes = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
    assert.deepEqual(readXlsxRows(bytes), [["Team Name", "", "Leader Email"], [], ["Rockets", "TRUE", "a@b.co"]]);
  });

  it("rejects old .xls / non-zip files with a clear message", () => {
    assert.throws(() => readXlsxRows(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), (e) => e instanceof XlsxReadError && /xlsx/.test(e.message));
  });

  it("round trip: the app's own Teams export imports back unchanged", async () => {
    const buf = await teamsToXlsx([{
      teamCode: "TH-01", name: "Rockets", projectTitle: "Moonshot", memberNames: ["Ada Lovelace", "Alan Turing"],
      leaderEmail: "ada@example.com", repoUrl: "https://github.com/r/m", university: "FAST", track: "AI",
      status: "Active", disqualifiedReason: null, createdAt: new Date("2026-10-02T18:04:47Z"),
    }]);
    const [op] = plan(readXlsxRows(new Uint8Array(buf))).ops;
    assert.deepEqual(op, {
      kind: "create", row: 2, teamCode: "TH-01",
      data: { name: "Rockets", projectTitle: "Moonshot", university: "FAST", track: "AI",
        memberNames: ["Ada Lovelace", "Alan Turing"], leaderEmail: "ada@example.com", repoUrl: "https://github.com/r/m" },
    });
  });
});

describe("Team import planning", () => {
  it("rows with missing details are still added, with a warning for each fix-up", () => {
    const p = plan([
      ["Team ID", "Team Name", "Team Leader Email", "GitHub Repository"],
      ["", "", "", ""],                       // blank row: skipped
      ["", "Rockets", "not-an-email", "nope"], // no ID, bad email, bad repo
      ["T9", "", "", ""],                     // no name
      ["", "", "x@y.io", ""],                 // nothing but an email
    ]);
    assert.equal(p.ops.length, 3);
    assert.deepEqual(p.ops.map((o) => [o.kind, o.teamCode, o.data.name]), [
      ["create", "TEAM-001", "Rockets"],
      ["create", "T9", "Unnamed team (T9)"],
      ["create", "TEAM-002", "Unnamed team (TEAM-002)"],
    ]);
    assert.equal(p.ops[0].data.leaderEmail, undefined);
    assert.equal(p.ops[0].data.repoUrl, undefined);
    assert.equal(p.ops[2].data.leaderEmail, "x@y.io");
    assert.equal(p.warnings.length, 6);
    assert.ok(p.warnings.every((w) => /^Row \d+: /.test(w)));
  });

  it("generated codes skip ones already taken", () => {
    const p = plan([["Team Name"], ["A"], ["B"]], [{ teamCode: "TEAM-001", name: "Old" }]);
    assert.deepEqual(p.ops.map((o) => o.teamCode), ["TEAM-002", "TEAM-003"]);
  });

  it("a row without an ID updates the existing team with the same name instead of duplicating it", () => {
    const p = plan([["Team Name", "Leader Email"], ["rockets", "ada@example.com"]], [{ teamCode: "T1", name: "Rockets" }]);
    assert.deepEqual(p.ops[0], { kind: "update", row: 2, teamCode: "T1", data: { name: "rockets", leaderEmail: "ada@example.com" } });
  });

  it("updates never blank stored values: empty cells are left out", () => {
    const p = plan([["Team ID", "Team Name", "Members", "GitHub"], ["T1", "", "", ""]], [{ teamCode: "T1", name: "Rockets" }]);
    assert.deepEqual(p.ops[0].data, {});
  });

  it("the same ID twice in one file: created once, then updated", () => {
    const p = plan([["id", "name"], ["T1", "A"], ["T1", "B"]]);
    assert.deepEqual(p.ops.map((o) => o.kind), ["create", "update"]);
  });

  it("understands common header names, leader + 'Member N' columns, and 'Name <email>' cells", () => {
    const p = plan([
      ["Reg No", "Name of Team", "Team Leader", "Member 1", "Member 2", "Email Address", "GitHub Link"],
      ["R-7", "Rockets", "Ada", "Alan", "ada", "Ada <ADA@Example.com>", "github.com/r/m"],
    ]);
    assert.deepEqual(p.ops[0].data, {
      name: "Rockets", memberNames: ["Ada", "Alan"], leaderEmail: "ada@example.com", repoUrl: "https://github.com/r/m",
    });
    assert.equal(p.ops[0].teamCode, "R-7");
  });

  it("errors only when nothing in the header is recognizable or the file is empty", () => {
    assert.equal(planTeamImport([["foo", "bar"], ["1", "2"]], []).ok, false);
    assert.equal(planTeamImport([], []).ok, false);
    assert.equal(planTeamImport([["Team Name"]], []).ok, false);
  });
});

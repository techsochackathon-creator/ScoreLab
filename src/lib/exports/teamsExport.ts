import type { PrismaClient } from "@prisma/client";
import writeXlsxFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { csvDateTime, toCsv } from "@/lib/exports/csv";

/**
 * Teams export (organizer only). Every team, in the same order as the Teams page
 * (track, then name) — the page has no search, filter or pagination to respect.
 * Values come straight from the Team records; nothing is derived except
 * "Team Status" (Active / Disqualified) and the member count.
 */

export interface TeamExportRow {
  teamCode: string;
  name: string;
  projectTitle: string | null;
  memberNames: string[];
  repoUrl: string | null;
  university: string;
  track: string;
  status: "Active" | "Disqualified";
  disqualifiedReason: string | null;
  createdAt: Date;
}

export async function getTeamsExportData(db: Pick<PrismaClient, "team">): Promise<TeamExportRow[]> {
  const teams = await db.team.findMany({
    orderBy: [{ track: "asc" }, { name: "asc" }],
    select: {
      teamCode: true, name: true, projectTitle: true, memberNames: true, repoUrl: true,
      university: true, track: true, disqualifiedAt: true, disqualifiedReason: true, createdAt: true,
    },
  });
  return teams.map((t) => ({
    teamCode: t.teamCode,
    name: t.name,
    projectTitle: t.projectTitle,
    memberNames: t.memberNames,
    repoUrl: t.repoUrl,
    university: t.university,
    track: t.track,
    status: t.disqualifiedAt ? "Disqualified" : "Active",
    disqualifiedReason: t.disqualifiedAt ? t.disqualifiedReason : null,
    createdAt: t.createdAt,
  }));
}

const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);

export const TEAM_HEADERS = [
  "Team ID", "Team Name", "Project Name", "Team Members", "Member Count", "GitHub Repository",
  "University", "Track", "Team Status", "Disqualification Reason", "Registration Date (UTC)",
];

export function teamsToCsv(rows: TeamExportRow[]): string {
  return toCsv(
    TEAM_HEADERS,
    rows.map((t) => [
      t.teamCode, t.name, blank(t.projectTitle), t.memberNames.join("; ") || null, t.memberNames.length,
      blank(t.repoUrl), blank(t.university), blank(t.track), t.status, blank(t.disqualifiedReason), csvDateTime(t.createdAt),
    ]),
  );
}

const header = (labels: string[]) => labels.map((value) => ({ value, fontWeight: "bold" as const }));
const text = (s: string | null | undefined) => (blank(s) === null ? null : { value: s as string, type: String });

/** Workbook: "Teams" (one row per team) and "Team Members" (one row per member). */
export async function teamsToXlsx(rows: TeamExportRow[]): Promise<Buffer> {
  const teamsSheet: SheetData = [
    header(TEAM_HEADERS),
    ...rows.map((t) => [
      text(t.teamCode), text(t.name), text(t.projectTitle), text(t.memberNames.join("; ")),
      { value: t.memberNames.length, type: Number },
      text(t.repoUrl), text(t.university), text(t.track), text(t.status), text(t.disqualifiedReason),
      { value: t.createdAt, type: Date, format: "yyyy-mm-dd hh:mm" },
    ]),
  ];
  const membersSheet: SheetData = [
    header(["Team ID", "Team Name", "Member #", "Member Name"]),
    ...rows.flatMap((t) =>
      t.memberNames.map((m, i) => [text(t.teamCode), text(t.name), { value: i + 1, type: Number }, text(m)]),
    ),
  ];
  return writeXlsxFile([
    { data: teamsSheet, sheet: "Teams", stickyRowsCount: 1, columns: [{ width: 14 }, { width: 26 }, { width: 26 }, { width: 40 }, { width: 10 }, { width: 44 }, { width: 22 }, { width: 14 }, { width: 13 }, { width: 30 }, { width: 20 }] },
    { data: membersSheet, sheet: "Team Members", stickyRowsCount: 1, columns: [{ width: 14 }, { width: 26 }, { width: 10 }, { width: 30 }] },
  ]).toBuffer();
}

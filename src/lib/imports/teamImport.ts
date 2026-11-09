import { z } from "zod";

/**
 * Team import planning (CSV or Excel), kept pure so it can be tested without a database.
 *
 * Lenient by design: a row is never rejected for missing or bad details. The team is
 * still added (organizers fix it later by hand) and a warning says what was left out:
 *   - no Team ID      → matched to an existing team with the same name, else a new
 *                       code is generated (TEAM-001, TEAM-002, …)
 *   - no team name    → "Unnamed team (<code>)"
 *   - bad repo URL    → left empty
 *   - bad leader email→ left empty
 * Only fully blank rows are skipped. Re-importing never blanks a field: on an
 * existing team, empty cells leave the stored value unchanged.
 */

export interface ExistingTeam {
  teamCode: string;
  name: string;
}

export interface TeamImportData {
  name?: string;
  projectTitle?: string;
  university?: string;
  track?: string;
  memberNames?: string[];
  repoUrl?: string;
  leaderEmail?: string;
}

export interface TeamImportOp {
  kind: "create" | "update";
  /** Row number as shown in Excel / a spreadsheet (header is row 1). */
  row: number;
  teamCode: string;
  data: TeamImportData;
}

export type TeamImportPlan =
  | { ok: true; ops: TeamImportOp[]; warnings: string[] }
  | { ok: false; error: string };

const LIMITS = { teamCode: 64, name: 200, projectTitle: 200, university: 200, track: 100, member: 200, leaderEmail: 254, repoUrl: 500 };

/** Header aliases, compared after lower-casing and removing everything but letters/digits. */
const ALIASES = {
  teamCode: ["teamcode", "code", "id", "teamid", "teamno", "teamnumber", "teamnum", "registrationid", "regid", "regno", "registrationno", "registrationnumber"],
  name: ["name", "teamname", "team", "nameofteam"],
  projectTitle: ["projecttitle", "projectname", "project", "title", "projecttopic"],
  members: ["members", "membernames", "teammembers", "member", "participants", "participantnames", "membersnames"],
  leaderName: ["leader", "teamleader", "leadername", "teamleadername", "teamlead", "lead", "captain", "teamcaptain"],
  leaderEmail: ["leaderemail", "teamleaderemail", "leademail", "teamleademail", "leaderemailaddress", "teamleaderemailaddress",
    "email", "emailaddress", "emailid", "contactemail", "teamemail", "captainemail"],
  repoUrl: ["repourl", "repo", "repository", "repositoryurl", "repositorylink", "github", "githuburl", "githubrepository",
    "githubrepo", "githublink", "githubrepositoryurl", "githubrepositorylink", "repolink", "projectrepository", "sourcecode"],
  university: ["university", "school", "college", "institute", "institution", "universityname", "uni"],
  track: ["track", "category", "theme"],
} as const;
type Field = keyof typeof ALIASES;

const norm = (h: string) => h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Member 1", "Member 2 Name", "Participant 3" … */
const MEMBER_N = /^(member|participant|teammember)\d+(name|fullname)?$/;

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const emailOk = (s: string) => z.string().email().safeParse(s).success;

/** Accept "github.com/x/y" and "www.github.com/x/y" by adding https://. */
function normalizeRepo(raw: string): string | null {
  const s = /^(www\.)?github\.com\//i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? s : null;
  } catch {
    return null;
  }
}

const splitMembers = (cell: string) => cell.split(/[;|,\n]/).map((m) => m.trim()).filter(Boolean);
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);

export function planTeamImport(rows: string[][], existing: ExistingTeam[]): TeamImportPlan {
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIdx < 0) return { ok: false, error: "The file is empty." };

  const header = rows[headerIdx].map(norm);
  const cols: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    const i = header.findIndex((h) => (ALIASES[field] as readonly string[]).includes(h));
    if (i >= 0) cols[field] = i;
  }
  // Any other column mentioning an email (e.g. "Leader's E-mail") counts as the leader email.
  if (cols.leaderEmail === undefined) {
    const i = header.findIndex((h) => h.includes("email") || h.includes("mail"));
    if (i >= 0) cols.leaderEmail = i;
  }
  const memberCols = header.map((h, i) => (MEMBER_N.test(h) ? i : -1)).filter((i) => i >= 0);

  if (Object.keys(cols).length === 0 && memberCols.length === 0) {
    return {
      ok: false,
      error: "No recognizable columns. The first row must be a header such as: Team ID, Team Name, Project Name, " +
        "Team Members, Team Leader Email, GitHub Repository.",
    };
  }

  const byCode = new Set(existing.map((t) => t.teamCode));
  const byName = new Map<string, string[]>();
  for (const t of existing) {
    const k = t.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), t.teamCode]);
  }
  const planned = new Set<string>();
  let seq = 0;
  const nextCode = () => {
    let code: string;
    do code = `TEAM-${String(++seq).padStart(3, "0")}`;
    while (byCode.has(code) || planned.has(code));
    return code;
  };

  const ops: TeamImportOp[] = [];
  const warnings: string[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.some((c) => (c ?? "").trim() !== "")) continue;
    const row = r + 1;
    const get = (f: Field) => (cols[f] !== undefined ? (cells[cols[f]!] ?? "").trim() : "");

    const data: TeamImportData = {};
    const rowWarn = (msg: string) => warnings.push(`Row ${row}: ${msg}`);

    let name = clip(get("name"), LIMITS.name);
    const projectTitle = clip(get("projectTitle"), LIMITS.projectTitle);
    const university = clip(get("university"), LIMITS.university);
    const track = clip(get("track"), LIMITS.track);
    if (projectTitle) data.projectTitle = projectTitle;
    if (university) data.university = university;
    if (track) data.track = track;

    // Members: leader first, then the members cell, then any "Member N" columns.
    const members: string[] = [];
    const leader = get("leaderName");
    if (leader) members.push(leader);
    members.push(...splitMembers(get("members")));
    for (const i of memberCols) members.push(...splitMembers(cells[i] ?? ""));
    const seen = new Set<string>();
    const unique = members.map((m) => clip(m, LIMITS.member)).filter((m) => !seen.has(m.toLowerCase()) && seen.add(m.toLowerCase()));
    if (unique.length) data.memberNames = unique;

    const emailCell = get("leaderEmail");
    if (emailCell) {
      const found = EMAIL_IN_TEXT.exec(emailCell)?.[0];
      if (found && emailOk(found) && found.length <= LIMITS.leaderEmail) data.leaderEmail = found.toLowerCase();
      else rowWarn(`"${clip(emailCell, 60)}" is not a valid email — leader email left empty.`);
    }

    const repoCell = get("repoUrl");
    if (repoCell) {
      const repo = normalizeRepo(repoCell);
      if (repo && repo.length <= LIMITS.repoUrl) data.repoUrl = repo;
      else rowWarn(`"${clip(repoCell, 60)}" is not a valid URL — repository left empty.`);
    }

    // Team ID: given, else the existing team with the same name, else a new code.
    let teamCode = clip(get("teamCode"), LIMITS.teamCode);
    if (!teamCode && name) {
      const matches = byName.get(name.toLowerCase()) ?? [];
      if (matches.length === 1) teamCode = matches[0];
    }
    if (!teamCode) {
      teamCode = nextCode();
      rowWarn(`no Team ID — added as ${teamCode}.`);
    }

    const exists = byCode.has(teamCode) || planned.has(teamCode);
    if (!name && !exists) {
      name = `Unnamed team (${teamCode})`;
      rowWarn(`no team name — added as "${name}".`);
    }
    if (name) data.name = name;

    ops.push({ kind: exists ? "update" : "create", row, teamCode, data });
    planned.add(teamCode);
  }

  if (ops.length === 0) return { ok: false, error: "The file has a header row but no teams under it." };
  return { ok: true, ops, warnings };
}

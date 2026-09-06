import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";

/**
 * POST /api/teams/import — CSV bulk import (upsert by teamCode).
 * Body: { csv: string }
 * Columns (header row required): teamCode, name, university, track, members
 * `members` is a single cell with names separated by ; or |.
 */

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, escaped quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let csv: string;
  try {
    csv = String((await req.json()).csv ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!csv.trim()) return NextResponse.json({ error: "CSV is empty" }, { status: 400 });

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return NextResponse.json({ error: "CSV needs a header row plus at least one team" }, { status: 400 });
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iCode = col(["teamcode", "team code", "code", "id"]);
  const iName = col(["name", "team name", "team"]);
  const iUni = col(["university", "school", "college"]);
  const iTrack = col(["track", "category"]);
  const iMembers = col(["members", "membernames", "member names", "team members"]);

  if (iCode < 0 || iName < 0 || iUni < 0 || iTrack < 0) {
    return NextResponse.json(
      { error: "CSV must have columns: teamCode, name, university, track (members optional)" },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const teamCode = (cells[iCode] ?? "").trim();
    const name = (cells[iName] ?? "").trim();
    const university = (cells[iUni] ?? "").trim();
    const track = (cells[iTrack] ?? "").trim();
    const memberNames =
      iMembers >= 0
        ? (cells[iMembers] ?? "")
            .split(/[;|]/)
            .map((m) => m.trim())
            .filter(Boolean)
        : [];

    if (!teamCode || !name || !university || !track) {
      errors.push(`Row ${r + 1}: missing required field(s)`);
      continue;
    }

    const existing = await prisma.team.findUnique({ where: { teamCode } });
    if (existing) {
      await prisma.team.update({ where: { teamCode }, data: { name, university, track, memberNames } });
      updated++;
    } else {
      await prisma.team.create({ data: { teamCode, name, university, track, memberNames } });
      created++;
    }
  }

  return NextResponse.json({ ok: true, created, updated, errors });
}

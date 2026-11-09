import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { assertJudgingOpen, JudgeServiceError, TEAMS_FINALIZED_MSG, whileJudgingOpen } from "@/lib/judges";
import { readCsvRows } from "@/lib/imports/csvReader";
import { MAX_XLSX_BYTES, readXlsxRows, XlsxReadError } from "@/lib/imports/xlsxReader";
import { planTeamImport } from "@/lib/imports/teamImport";

export const runtime = "nodejs";

/**
 * POST /api/teams/import — bulk import teams (upsert by Team ID). Organizer only.
 * Body: multipart form with `file` (.xlsx or .csv), or JSON { csv: string } for pasted text.
 * Rows with missing details are still added; see src/lib/imports/teamImport.ts.
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function readRows(req: Request): Promise<string[][] | NextResponse> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      return bad("Invalid upload");
    }
    if (!(file instanceof File) || file.size === 0) return bad("Choose a .xlsx or .csv file to import.");
    if (file.size > MAX_XLSX_BYTES) return bad("The file is too large (max 4 MB).");
    const name = file.name.toLowerCase();
    if (name.endsWith(".xls")) return bad("Old .xls files aren't supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
    if (name.endsWith(".csv") || name.endsWith(".txt")) return readCsvRows(await file.text());
    try {
      return readXlsxRows(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof XlsxReadError) return bad(e.message);
      throw e;
    }
  }
  try {
    const csv = String((await req.json()).csv ?? "");
    if (!csv.trim()) return bad("CSV is empty");
    return readCsvRows(csv);
  } catch {
    return bad("Invalid body");
  }
}

export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Teams are frozen once results are finalized (fast check; writes below are guarded too).
  try {
    await assertJudgingOpen(prisma, TEAMS_FINALIZED_MSG);
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const rows = await readRows(req);
  if (rows instanceof NextResponse) return rows;

  const existing = await prisma.team.findMany({ select: { teamCode: true, name: true } });
  const plan = planTeamImport(rows, existing);
  if (!plan.ok) return bad(plan.error);

  let created = 0;
  let updated = 0;
  for (const op of plan.ops) {
    const { data, teamCode } = op;
    const write = op.kind === "create"
      ? prisma.team.create({
          data: {
            teamCode,
            name: data.name ?? `Unnamed team (${teamCode})`,
            projectTitle: data.projectTitle ?? null,
            university: data.university ?? "",
            track: data.track ?? "General",
            memberNames: data.memberNames ?? [],
            repoUrl: data.repoUrl ?? null,
            leaderEmail: data.leaderEmail ?? null,
          },
        })
      : prisma.team.update({ where: { teamCode }, data });
    try {
      await whileJudgingOpen(prisma, [write], TEAMS_FINALIZED_MSG);
      if (op.kind === "create") created++;
      else updated++;
    } catch (e) {
      // Finalized mid-import: stop; rows already written committed before finalization.
      if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message, created, updated }, { status: e.status });
      throw e;
    }
  }

  return NextResponse.json({ ok: true, created, updated, warnings: plan.warnings });
}

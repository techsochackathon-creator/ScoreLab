import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { judgeErrorResponse } from "@/lib/judgeApi";
import { getTeamsExportData, teamsToCsv, teamsToXlsx } from "@/lib/exports/teamsExport";
import { getResultsExportData, resultsToCsv, resultsToXlsx } from "@/lib/exports/resultsExport";

// write-excel-file/node needs Node (Buffer); always fresh, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * GET /api/organizer/export/teams?format=csv|xlsx
 * GET /api/organizer/export/results?format=csv|xlsx
 * Organizer only (requireOrganizer, incl. the live active check). Results include
 * judge names and individual scores, so there is deliberately no public variant.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    await requireOrganizer();
    const { kind } = await params;
    const format = new URL(req.url).searchParams.get("format") ?? "csv";
    if (kind !== "teams" && kind !== "results") return NextResponse.json({ error: "Unknown export" }, { status: 404 });
    if (format !== "csv" && format !== "xlsx") return NextResponse.json({ error: "format must be csv or xlsx" }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `ScoreLab_${kind === "teams" ? "Teams" : "Results"}_${date}.${format}`;

    let body: string | Buffer;
    if (kind === "teams") {
      const rows = await getTeamsExportData(prisma);
      body = format === "csv" ? teamsToCsv(rows) : await teamsToXlsx(rows);
    } else {
      const data = await getResultsExportData(prisma);
      body = format === "csv" ? resultsToCsv(data) : await resultsToXlsx(data);
    }

    return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

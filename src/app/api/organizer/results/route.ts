import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { getJudgeResults } from "@/lib/judgeResults";
import { finalizationBlockers, getOfficialState } from "@/lib/officialResults";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * GET /api/organizer/results — organizer only.
 * Finalized: the frozen snapshot (authoritative). Open: live results plus what
 * still blocks finalization. Takes no input.
 */
export async function GET() {
  try {
    await requireOrganizer();
    const state = await getOfficialState(prisma);
    if (state) return NextResponse.json({ phase: state.publishedAt ? "PUBLISHED" : "FINALIZED", ...state });
    const results = await getJudgeResults(prisma);
    return NextResponse.json({ phase: "JUDGING_OPEN", results, blockers: finalizationBlockers(results) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

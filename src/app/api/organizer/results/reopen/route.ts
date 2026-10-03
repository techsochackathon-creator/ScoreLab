import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { reopenJudging } from "@/lib/officialResults";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * POST /api/organizer/results/reopen — organizer only.
 * Unpublishes and deletes the frozen official result so judging is open again.
 * Evaluations, assignments, teams and the rubric are NOT touched; submitted
 * evaluations stay locked. 409 if judging isn't finalized.
 */
export async function POST() {
  try {
    await requireOrganizer();
    await reopenJudging(prisma);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

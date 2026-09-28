import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { saveDraft } from "@/lib/judgeEvaluations";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * PATCH /api/judge/evaluations/:id — save draft scores.
 * Body: { scores: [{ criterionId, score: number | null }] }. 409 once submitted.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const judge = await requireJudge();
    const { id } = await params;
    return NextResponse.json({ evaluation: await saveDraft(prisma, judge.id, id, await req.json()) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

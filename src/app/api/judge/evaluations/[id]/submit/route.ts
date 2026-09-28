import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { submitEvaluation } from "@/lib/judgeEvaluations";
import { judgeErrorResponse } from "@/lib/judgeApi";

/** POST /api/judge/evaluations/:id/submit — finalize; every criterion must be scored. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const judge = await requireJudge();
    const { id } = await params;
    return NextResponse.json({ evaluation: await submitEvaluation(prisma, judge.id, id) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

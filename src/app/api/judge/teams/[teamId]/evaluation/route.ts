import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { getEvaluation, getOrStartEvaluation } from "@/lib/judgeEvaluations";
import { judgeErrorResponse } from "@/lib/judgeApi";

type Ctx = { params: Promise<{ teamId: string }> };

/** GET /api/judge/teams/:teamId/evaluation — the judge's evaluation of this team, or null. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const judge = await requireJudge();
    const { teamId } = await params;
    return NextResponse.json({ evaluation: await getEvaluation(prisma, judge.id, teamId) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/** POST /api/judge/teams/:teamId/evaluation — start (or load) the evaluation. Idempotent. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const judge = await requireJudge();
    const { teamId } = await params;
    return NextResponse.json({ evaluation: await getOrStartEvaluation(prisma, judge.id, teamId) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

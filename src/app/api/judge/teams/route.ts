import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { listTeamsWithStatus, summarizeProgress } from "@/lib/judgeEvaluations";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * GET /api/judge/teams — the signed-in judge's assigned teams (blind fields)
 * with their own evaluation status. The judge is taken from the session; there
 * is no judgeId parameter to spoof.
 */
export async function GET() {
  try {
    const judge = await requireJudge();
    const teams = await listTeamsWithStatus(prisma, judge.id);
    return NextResponse.json({ judge, teams, assignmentCount: teams.length, progress: summarizeProgress(teams.map((t) => t.status)) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

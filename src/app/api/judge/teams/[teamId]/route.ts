import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { requireAssignedTeam } from "@/lib/judgeEvaluations";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * GET /api/judge/teams/:teamId — one team (blind fields), only if assigned to the
 * signed-in judge. Unassigned and nonexistent teams both return 404 so team ids
 * can't be probed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const judge = await requireJudge();
    const { teamId } = await params;
    return NextResponse.json({ team: await requireAssignedTeam(prisma, judge.id, teamId) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

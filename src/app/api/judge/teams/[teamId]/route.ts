import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJudge } from "@/lib/requireOrganizer";
import { getAssignedTeam } from "@/lib/judges";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * GET /api/judge/teams/:teamId — one team, only if assigned to the signed-in judge.
 * Unassigned and nonexistent teams both return 404 so team ids can't be probed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const judge = await requireJudge();
    const { teamId } = await params;
    const team = await getAssignedTeam(prisma, judge.id, teamId);
    if (!team) return NextResponse.json({ error: "Team not found or not assigned to you" }, { status: 404 });
    return NextResponse.json({ team });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { disqualifyTeam, reinstateTeam } from "@/lib/disqualification";
import { judgeErrorResponse } from "@/lib/judgeApi";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/teams/:id/disqualification — body { reason }. Organizer only.
 * Excludes the team from the official ranking. 409 once results are finalized
 * (reopen judging first) or if the team is already disqualified.
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ team: await disqualifyTeam(prisma, id, await req.json()) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/** DELETE /api/teams/:id/disqualification — reinstate the team. Same locks as PUT. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ team: await reinstateTeam(prisma, id) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

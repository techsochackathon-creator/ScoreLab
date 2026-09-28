import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { assignTeams, listAssignments, removeAssignment, JudgeServiceError } from "@/lib/judges";
import { judgeErrorResponse } from "@/lib/judgeApi";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/judges/:id/assignments — teams assigned to this judge (organizer only). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ teams: await listAssignments(prisma, id) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/** POST /api/judges/:id/assignments — body { teamIds: string[] }. All-or-nothing. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireOrganizer();
    const { id } = await params;
    const teams = await assignTeams(prisma, id, await req.json());
    return NextResponse.json({ teams }, { status: 201 });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/** DELETE /api/judges/:id/assignments?teamId=… — remove one assignment. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireOrganizer();
    const { id } = await params;
    const teamId = new URL(req.url).searchParams.get("teamId");
    if (!teamId) throw new JudgeServiceError(400, "teamId is required");
    await removeAssignment(prisma, id, teamId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

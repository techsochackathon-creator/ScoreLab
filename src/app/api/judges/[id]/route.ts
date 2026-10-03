import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { getJudge, updateJudge } from "@/lib/judges";
import { judgeErrorResponse } from "@/lib/judgeApi";

/** GET /api/judges/:id — one judge (organizer only). 404 for non-judge users. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ judge: await getJudge(prisma, id) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/**
 * PATCH /api/judges/:id — any of { name, email, password, active }.
 * No DELETE: disable instead, which keeps assignments and history.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ judge: await updateJudge(prisma, id, await req.json()) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

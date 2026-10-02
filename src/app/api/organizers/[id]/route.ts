import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { setOrganizerActive } from "@/lib/organizers";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * PATCH /api/organizers/:id — body { active: boolean }. Organizer only.
 * Cannot disable yourself or the last active organizer. There is no DELETE:
 * disable instead.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireOrganizer();
    const { id } = await params;
    return NextResponse.json({ organizer: await setOrganizerActive(prisma, session.user.id, id, await req.json()) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

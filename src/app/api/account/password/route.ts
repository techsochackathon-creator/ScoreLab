import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { changeOwnPassword } from "@/lib/organizers";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * PUT /api/account/password — body { currentPassword, newPassword }.
 * Changes the SIGNED-IN organizer's own password. The account comes from the
 * session; there is no user id in the request to point at someone else.
 */
export async function PUT(req: Request) {
  try {
    const session = await requireOrganizer();
    await changeOwnPassword(prisma, session.user.id, await req.json());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

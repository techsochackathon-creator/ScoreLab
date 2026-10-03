import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { createOrganizer, listOrganizers } from "@/lib/organizers";
import { judgeErrorResponse } from "@/lib/judgeApi";

/** GET /api/organizers — all organizer accounts (organizer only). */
export async function GET() {
  try {
    await requireOrganizer();
    return NextResponse.json({ organizers: await listOrganizers(prisma) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/**
 * POST /api/organizers — body { name, email, password }. Organizer only.
 * The role is always ORGANIZER; a `role` (or any other extra) field is rejected.
 */
export async function POST(req: Request) {
  try {
    await requireOrganizer();
    const organizer = await createOrganizer(prisma, await req.json());
    return NextResponse.json({ organizer }, { status: 201 });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

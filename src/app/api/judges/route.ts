import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { createJudge, listJudges } from "@/lib/judges";
import { judgeErrorResponse } from "@/lib/judgeApi";

/** GET /api/judges — all judge accounts with assignment counts (organizer only). */
export async function GET() {
  try {
    await requireOrganizer();
    return NextResponse.json({ judges: await listJudges(prisma) });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/**
 * POST /api/judges — create a judge. Body: { name, email, password }.
 * Role is always JUDGE; a `role` (or any other extra) field is rejected.
 */
export async function POST(req: Request) {
  try {
    await requireOrganizer();
    const judge = await createJudge(prisma, await req.json());
    return NextResponse.json({ judge }, { status: 201 });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

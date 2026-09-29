import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { publishResults, unpublishResults } from "@/lib/officialResults";
import { judgeErrorResponse } from "@/lib/judgeApi";

/** POST /api/organizer/results/publish — show the official results on /leaderboard. */
export async function POST() {
  try {
    const session = await requireOrganizer();
    await publishResults(prisma, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

/** DELETE /api/organizer/results/publish — hide the public results again. */
export async function DELETE() {
  try {
    await requireOrganizer();
    await unpublishResults(prisma);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

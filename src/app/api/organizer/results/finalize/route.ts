import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { finalizeResults } from "@/lib/officialResults";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * POST /api/organizer/results/finalize — freeze the official result (irreversible).
 * 400 with the reasons if a team has no submitted evaluation or first place is tied;
 * 409 if already finalized. There is deliberately no endpoint to undo or edit it.
 */
export async function POST() {
  try {
    const session = await requireOrganizer();
    const state = await finalizeResults(prisma, session.user.id);
    return NextResponse.json({ finalizedAt: state.finalizedAt, snapshot: state.snapshot }, { status: 201 });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

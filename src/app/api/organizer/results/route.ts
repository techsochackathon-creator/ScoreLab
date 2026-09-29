import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganizer } from "@/lib/requireOrganizer";
import { getJudgeResults } from "@/lib/judgeResults";
import { getPublication } from "@/lib/officialResults";
import { judgeErrorResponse } from "@/lib/judgeApi";

/**
 * GET /api/organizer/results — official (judge-score) results for the organizer,
 * plus whether they are published. Computed from SUBMITTED judge evaluations on
 * every request; takes no input.
 */
export async function GET() {
  try {
    await requireOrganizer();
    const [results, publication] = await Promise.all([getJudgeResults(prisma), getPublication(prisma)]);
    return NextResponse.json({ results, publishedAt: publication?.publishedAt ?? null });
  } catch (e) {
    return judgeErrorResponse(e);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { getRubricLockState } from "@/lib/rubricLock";

/**
 * POST /api/rubrics/lock — manually freeze a track's rubric.
 * Body: { trackId }. Useful to lock a finalized rubric before evaluation
 * tooling exists to lock it automatically.
 */
export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body: { trackId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const rubric = await prisma.rubric.findFirst({
    where: { trackId: body.trackId },
  });
  if (!rubric) {
    return NextResponse.json(
      { error: "No rubric exists for this track yet" },
      { status: 404 },
    );
  }
  if (!rubric.lockedAt) {
    await prisma.rubric.update({
      where: { id: rubric.id },
      data: { lockedAt: new Date() },
    });
  }

  const lock = await getRubricLockState(body.trackId);
  return NextResponse.json({ ok: true, lock });
}

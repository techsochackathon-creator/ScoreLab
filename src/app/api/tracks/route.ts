import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { getRubricLockState } from "@/lib/rubricLock";

/** GET /api/tracks — tracks with their rubric summary + lock state. */
export async function GET() {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const tracks = await prisma.track.findMany({ orderBy: { name: "asc" } });

  const withState = await Promise.all(
    tracks.map(async (t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      lock: await getRubricLockState(t.id),
    })),
  );

  return NextResponse.json({ tracks: withState });
}

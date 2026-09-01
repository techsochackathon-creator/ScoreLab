import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireOrganizer() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: "Not authenticated", status: 401 as const };
  if (session.user.role !== "ORGANIZER")
    return { error: "Organizer access required", status: 403 as const };
  return { ok: true as const };
}

/** POST /api/tracks/[id]/publish — publish (lock scores + public leaderboard). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOrganizer();
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const updated = await prisma.track.update({
    where: { id },
    data: { publishedAt: track.publishedAt ?? new Date() },
  });
  return NextResponse.json({
    ok: true,
    published: true,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
  });
}

/** DELETE /api/tracks/[id]/publish — unpublish (unlock, hide public board). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOrganizer();
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  await prisma.track.update({ where: { id }, data: { publishedAt: null } });
  return NextResponse.json({ ok: true, published: false });
}

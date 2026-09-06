import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";

const teamUpdate = z.object({
  teamCode: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  university: z.string().trim().min(1).max(200),
  track: z.string().trim().min(1).max(100),
  memberNames: z.array(z.string().trim().min(1)).default([]),
  projectTitle: z.string().trim().max(200).optional().nullable(),
  projectDescription: z.string().trim().max(2000).optional().nullable(),
  technologies: z.array(z.string().trim().min(1)).default([]),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;

  let data;
  try {
    data = teamUpdate.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const clash = await prisma.team.findFirst({
    where: { teamCode: data.teamCode, NOT: { id } },
  });
  if (clash) {
    return NextResponse.json({ error: `Team code "${data.teamCode}" already exists` }, { status: 409 });
  }

  try {
    const team = await prisma.team.update({ where: { id }, data });
    return NextResponse.json({ team });
  } catch {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
}

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";

const teamInput = z.object({
  teamCode: z.string().trim().min(1, "team code is required").max(64),
  name: z.string().trim().min(1, "name is required").max(200),
  university: z.string().trim().min(1, "university is required").max(200),
  track: z.string().trim().min(1, "track is required").max(100),
  memberNames: z.array(z.string().trim().min(1)).default([]),
  projectTitle: z.string().trim().max(200).optional().nullable(),
  projectDescription: z.string().trim().max(2000).optional().nullable(),
  technologies: z.array(z.string().trim().min(1)).default([]),
});

export async function GET() {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const teams = await prisma.team.findMany({ orderBy: [{ track: "asc" }, { name: "asc" }] });
  return NextResponse.json({ teams });
}

export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let data;
  try {
    data = teamInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const existing = await prisma.team.findUnique({ where: { teamCode: data.teamCode } });
  if (existing) {
    return NextResponse.json({ error: `Team code "${data.teamCode}" already exists` }, { status: 409 });
  }

  const team = await prisma.team.create({ data });
  return NextResponse.json({ team }, { status: 201 });
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { teamCreateInput, firstFieldError } from "@/lib/teamSchemas";
import { assertJudgingOpen, JudgeServiceError, TEAMS_FINALIZED_MSG, whileJudgingOpen } from "@/lib/judges";


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

  // Teams are frozen once results are finalized (fast check; writes below are guarded too).
  try {
    await assertJudgingOpen(prisma, TEAMS_FINALIZED_MSG);
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let data;
  try {
    data = teamCreateInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      const fields = e.flatten().fieldErrors;
      const why = firstFieldError(fields);
      return NextResponse.json({ error: why ? `Validation failed — ${why}` : "Validation failed", details: fields }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const existing = await prisma.team.findUnique({ where: { teamCode: data.teamCode } });
  if (existing) {
    return NextResponse.json({ error: `Team code "${data.teamCode}" already exists` }, { status: 409 });
  }

  try {
    const [team] = await whileJudgingOpen(prisma, [prisma.team.create({ data })], TEAMS_FINALIZED_MSG);
    return NextResponse.json({ team }, { status: 201 });
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { teamUpdateInput, firstFieldError } from "@/lib/teamSchemas";
import { assertJudgingOpen, JudgeServiceError, TEAMS_FINALIZED_MSG, whileJudgingOpen } from "@/lib/judges";


export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;

  let data;
  try {
    data = teamUpdateInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      const fields = e.flatten().fieldErrors;
      const why = firstFieldError(fields);
      return NextResponse.json({ error: why ? `Validation failed — ${why}` : "Validation failed", details: fields }, { status: 400 });
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
    const [team] = await whileJudgingOpen(prisma, [prisma.team.update({ where: { id }, data })], TEAMS_FINALIZED_MSG);
    return NextResponse.json({ team });
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
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

  // Teams are frozen once results are finalized (fast check; writes below are guarded too).
  try {
    await assertJudgingOpen(prisma, TEAMS_FINALIZED_MSG);
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { id } = await params;
  try {
    await whileJudgingOpen(prisma, [prisma.team.delete({ where: { id } })], TEAMS_FINALIZED_MSG);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
}

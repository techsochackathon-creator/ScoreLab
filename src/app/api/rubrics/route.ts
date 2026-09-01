import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { getRubricLockState } from "@/lib/rubricLock";
import {
  rubricSaveSchema,
  validateRubricCriteria,
} from "@/lib/scoringRules";

/** GET /api/rubrics?trackId=... — the track's rubric with criteria + lock. */
export async function GET(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const trackId = new URL(req.url).searchParams.get("trackId");
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const rubric = await prisma.rubric.findFirst({
    where: { trackId },
    include: { criteria: { orderBy: { createdAt: "asc" } } },
  });
  const lock = await getRubricLockState(trackId);

  return NextResponse.json({
    trackId,
    trackName: track.name,
    rubricName: rubric?.name ?? `${track.name} Rubric`,
    lock,
    criteria: (rubric?.criteria ?? []).map((c) => ({
      name: c.name,
      checkType: c.checkType,
      // Persisted as a fraction; the editor works in percentages.
      weightPercent: Math.round(c.weight * 1000) / 10,
      scoringRules: c.scoringRules,
    })),
  });
}

/**
 * POST /api/rubrics — create or replace the track's rubric.
 * Body: { trackId, name?, criteria: [{ name, checkType, weightPercent, scoringRules }] }
 * Rejected with 409 if the rubric is locked.
 */
export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Parse envelope.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = rubricSaveSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten() },
        { status: 400 },
      );
    }
    throw e;
  }

  const track = await prisma.track.findUnique({ where: { id: input.trackId } });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  // Lock check — cannot edit once evaluation has started (or manual freeze).
  const lock = await getRubricLockState(input.trackId);
  if (lock.locked) {
    return NextResponse.json(
      { error: "Rubric is locked and cannot be edited", lock },
      { status: 409 },
    );
  }

  // Cross-criterion validation (weights sum to 100, unique names, valid rules).
  const result = validateRubricCriteria(input.criteria);
  if (!result.ok || !result.normalized) {
    return NextResponse.json(
      {
        error: result.formError ?? "Criteria validation failed",
        criterionErrors: result.errors,
      },
      { status: 400 },
    );
  }

  const rubricName = input.name ?? `${track.name} Rubric`;

  // Replace criteria atomically: upsert the (single) rubric, wipe & recreate.
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.rubric.findFirst({
      where: { trackId: input.trackId },
    });

    const rubric = existing
      ? await tx.rubric.update({
          where: { id: existing.id },
          data: { name: rubricName },
        })
      : await tx.rubric.create({
          data: { trackId: input.trackId, name: rubricName },
        });

    await tx.rubricCriterion.deleteMany({ where: { rubricId: rubric.id } });

    await tx.rubricCriterion.createMany({
      data: result.normalized!.map((c) => ({
        rubricId: rubric.id,
        name: c.name.trim(),
        checkType: c.checkType,
        weight: c.weightPercent / 100, // store as fraction
        scoringRules: c.scoringRules as Prisma.InputJsonValue,
      })),
    });

    return rubric;
  });

  return NextResponse.json({
    ok: true,
    rubricId: saved.id,
    criteriaCount: result.normalized.length,
  });
}

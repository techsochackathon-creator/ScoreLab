import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { getOrCreateRubric } from "@/lib/rubric";
import { assertRubricEditable, JudgeServiceError } from "@/lib/judges";
import type { Prisma } from "@prisma/client";

const anchor = z.object({ score: z.number().int().min(0), label: z.string().trim().max(500) });

/**
 * weight: whole-number percentage; all criteria must total 100. scaleMax: the
 * criterion's max score (1–100). anchors: optional score-band descriptions.
 */
const criterion = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  description: z.string().trim().max(2000).default(""),
  weight: z.number().int().min(0).max(100),
  scaleMax: z.number().int().min(1).max(100).default(5),
  anchors: z.array(anchor).max(20).default([]),
});

const rubricSave = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  criteria: z.array(criterion).min(1, "add at least one criterion"),
});

export async function GET() {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const rubric = await getOrCreateRubric();
  return NextResponse.json({ rubric });
}

/** PUT /api/rubric — replace all criteria. Weights must sum to 100. */
export async function PUT(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Saving deletes and recreates every Criterion, so it is locked once judging has started.
  try {
    await assertRubricEditable(prisma);
  } catch (e) {
    if (e instanceof JudgeServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let data;
  try {
    data = rubricSave.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sum = data.criteria.reduce((s, c) => s + c.weight, 0);
  if (sum !== 100) {
    return NextResponse.json({ error: `Weights must total 100 (currently ${sum}).` }, { status: 400 });
  }
  // Score-band descriptions must sit on the criterion's own scale.
  for (const c of data.criteria) {
    const bad = c.anchors.find((a) => a.score > c.scaleMax);
    if (bad) {
      return NextResponse.json(
        { error: `Criterion "${c.name}": a score band starts at ${bad.score}, above the max score ${c.scaleMax}.` },
        { status: 400 },
      );
    }
  }

  const rubric = await getOrCreateRubric();

  await prisma.$transaction([
    prisma.criterion.deleteMany({ where: { rubricId: rubric.id } }),
    prisma.rubric.update({
      where: { id: rubric.id },
      data: {
        name: data.name ?? rubric.name,
        criteria: {
          create: data.criteria.map((c, i) => ({
            name: c.name,
            description: c.description,
            weight: c.weight,
            scaleMax: c.scaleMax,
            anchors: [...c.anchors].filter((a) => a.label).sort((x, y) => x.score - y.score) as unknown as Prisma.InputJsonValue,
            order: i,
          })),
        },
      },
    }),
  ]);

  const saved = await prisma.rubric.findUnique({
    where: { id: rubric.id },
    include: { criteria: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json({ ok: true, rubric: saved });
}

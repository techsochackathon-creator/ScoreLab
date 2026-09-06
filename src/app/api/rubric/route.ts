import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { getOrCreateRubric } from "@/lib/rubric";
import type { Prisma } from "@prisma/client";

const anchor = z.object({ score: z.number().int().min(1), label: z.string().trim() });

const criterion = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  description: z.string().trim().max(2000).default(""),
  weight: z.number().int().min(0).max(100),
  scaleMax: z.number().int().min(2).max(10).default(5),
  anchors: z.array(anchor).min(1),
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
    return NextResponse.json({ error: `Weights must sum to 100 (currently ${sum}).` }, { status: 400 });
  }
  // Each criterion needs one anchor per scale point.
  for (const c of data.criteria) {
    if (c.anchors.length !== c.scaleMax) {
      return NextResponse.json(
        { error: `Criterion "${c.name}" needs exactly ${c.scaleMax} anchor(s).` },
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
            anchors: c.anchors as unknown as Prisma.InputJsonValue,
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

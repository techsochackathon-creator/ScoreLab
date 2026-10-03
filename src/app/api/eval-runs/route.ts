import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import {
  createEvalRun,
  listEvalRuns,
  getEvalRun,
  checkReadiness,
  finalizeRun,
  publishRun,
  unpublishRun,
  deleteEvalRun,
  revertToDraft,
} from "@/lib/evalRunEngine";

// ---------------------------------------------------------------------------
// GET /api/eval-runs                — list all runs
// GET /api/eval-runs?id=<runId>     — single run detail
// GET /api/eval-runs?readiness=1    — readiness check
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { searchParams } = new URL(req.url);

  if (searchParams.get("readiness") === "1") {
    const readiness = await checkReadiness();
    return NextResponse.json(readiness);
  }

  const id = searchParams.get("id");
  if (id) {
    try {
      const run = await getEvalRun(id);
      return NextResponse.json(run);
    } catch {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
  }

  const runs = await listEvalRuns();
  return NextResponse.json({ runs });
}

// ---------------------------------------------------------------------------
// POST /api/eval-runs — create a new run
// ---------------------------------------------------------------------------

const createInput = z.object({
  name: z.string().trim().max(100).optional(),
});

export async function POST(req: Request) {
  let userId: string | undefined;
  try {
    const session = await requireOrganizer();
    userId = (session as { user?: { id?: string } })?.user?.id;
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body;
  try {
    body = createInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const run = await createEvalRun({ name: body.name, createdBy: userId });
    return NextResponse.json(run, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/eval-runs — state transitions
//   action: "finalize" | "publish" | "unpublish" | "revert"
// ---------------------------------------------------------------------------

const patchInput = z.object({
  runId: z.string().trim(),
  action: z.enum(["finalize", "publish", "unpublish", "revert"]),
  force: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body;
  try {
    body = patchInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "finalize": {
        const run = await finalizeRun(body.runId, { force: body.force, note: body.note });
        return NextResponse.json(run);
      }
      case "publish": {
        const run = await publishRun(body.runId);
        return NextResponse.json(run);
      }
      case "unpublish": {
        const run = await unpublishRun(body.runId);
        return NextResponse.json(run);
      }
      case "revert": {
        const run = await revertToDraft(body.runId);
        return NextResponse.json(run);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/eval-runs?id=<runId> — delete a DRAFT run
// ---------------------------------------------------------------------------

export async function DELETE(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Provide ?id=<runId>" }, { status: 400 });
  }

  try {
    await deleteEvalRun(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

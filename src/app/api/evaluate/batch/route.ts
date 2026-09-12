import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import {
  createBatch,
  executeBatch,
  getProgress,
  cancelBatch,
  pauseBatch,
  resumeBatch,
  retryJobsByStatus,
  getJobDetails,
} from "@/lib/batchEngine";
import { prisma } from "@/lib/prisma";

// Batch jobs can take minutes; set a generous serverless timeout.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/evaluate/batch — create + launch a batch
// ---------------------------------------------------------------------------

const createInput = z.object({
  teamIds: z.array(z.string().trim()).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
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
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const { batch, skippedTeamIds } = await createBatch({
      teamIds: body.teamIds,
      concurrency: body.concurrency,
      maxRetries: body.maxRetries,
      createdBy: userId,
    });

    // Fire-and-forget: execute the batch in the background.
    // On Vercel this continues in the same invocation (maxDuration=300).
    executeBatch(batch.id).catch((err) => {
      console.error(`[batch ${batch.id}] execution error:`, err);
    });

    const progress = await getProgress(batch.id);
    return NextResponse.json({ batch: progress, skippedTeamIds }, { status: 202 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/evaluate/batch?id=<batchRunId>           — batch progress + jobs
// GET /api/evaluate/batch?id=<batchRunId>&summary=1 — progress only (no jobs)
// GET /api/evaluate/batch                           — list recent batches
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
  const id = searchParams.get("id");

  if (id) {
    try {
      const progress = await getProgress(id);
      const summaryOnly = searchParams.get("summary") === "1";
      if (summaryOnly) {
        return NextResponse.json({ batch: progress });
      }
      const jobs = await getJobDetails(id);
      return NextResponse.json({ batch: progress, jobs });
    } catch {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
  }

  // List recent batches.
  const batches = await prisma.batchRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { _count: { select: { jobs: true } } },
  });

  return NextResponse.json({
    batches: batches.map((b) => ({
      id: b.id,
      status: b.status,
      totalJobs: b.totalJobs,
      concurrency: b.concurrency,
      createdAt: b.createdAt,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
    })),
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/evaluate/batch — operational controls
//   action: "pause" | "resume" | "retry"
// ---------------------------------------------------------------------------

const patchInput = z.object({
  batchRunId: z.string().trim(),
  action: z.enum(["pause", "resume", "retry"]),
  retryStatus: z.enum(["FAILED", "REVIEW_REQUIRED"]).optional(),
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
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "pause": {
        const progress = await pauseBatch(body.batchRunId);
        return NextResponse.json({ batch: progress });
      }

      case "resume": {
        const progress = await resumeBatch(body.batchRunId);

        // Re-execute the batch to process remaining QUEUED jobs.
        executeBatch(body.batchRunId).catch((err) => {
          console.error(`[batch ${body.batchRunId}] resume error:`, err);
        });

        return NextResponse.json({ batch: progress });
      }

      case "retry": {
        if (!body.retryStatus) {
          return NextResponse.json(
            { error: "retryStatus is required for action 'retry'" },
            { status: 400 },
          );
        }

        const { requeued } = await retryJobsByStatus(body.batchRunId, body.retryStatus);
        if (requeued === 0) {
          return NextResponse.json(
            { error: `No ${body.retryStatus.toLowerCase().replace("_", " ")} jobs to retry` },
            { status: 400 },
          );
        }

        // Re-execute the batch to process re-queued jobs.
        executeBatch(body.batchRunId).catch((err) => {
          console.error(`[batch ${body.batchRunId}] retry error:`, err);
        });

        const progress = await getProgress(body.batchRunId);
        return NextResponse.json({ batch: progress, requeued });
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/evaluate/batch?id=<batchRunId> — cancel a batch
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
    return NextResponse.json({ error: "Provide ?id=<batchRunId>" }, { status: 400 });
  }

  try {
    const progress = await cancelBatch(id);
    return NextResponse.json({ batch: progress });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseManifestYaml, submissionInputSchema } from "@/lib/validation";
import { enqueueEvaluation } from "@/lib/eval/enqueue";

function badRequest(error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status: 400 });
}

/**
 * POST /api/submissions
 * JSON body: { repoUrl, liveUrl?, manifestYaml, pitchDeckBlobUrl? }
 * The pitch deck is already in Vercel Blob (client upload); we store its URL.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "TEAM" || !session.user.teamId) {
    return NextResponse.json(
      { error: "Only team accounts can submit" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  let input;
  try {
    input = submissionInputSchema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      return badRequest("Validation failed", e.flatten().fieldErrors);
    }
    throw e;
  }

  let manifest;
  try {
    manifest = parseManifestYaml(input.manifestYaml);
  } catch (e) {
    if (e instanceof ZodError) {
      return badRequest("Invalid manifest.yaml", e.flatten().fieldErrors);
    }
    return badRequest((e as Error).message);
  }

  const submission = await prisma.submission.create({
    data: {
      teamId: session.user.teamId,
      repoUrl: input.repoUrl,
      liveUrl: input.liveUrl,
      pitchDeckBlobUrl: input.pitchDeckBlobUrl,
      manifest,
    },
  });

  // Kick off evaluation. Best-effort: a queueing hiccup must not fail the
  // submission itself (organizers can re-trigger via POST /api/evaluations).
  let jobId: string | null = null;
  try {
    jobId = await enqueueEvaluation(submission.id, "submit");
  } catch (e) {
    console.error("Failed to enqueue evaluation", e);
  }

  return NextResponse.json(
    { id: submission.id, submittedAt: submission.submittedAt, jobId },
    { status: 201 },
  );
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const where =
    session.user.role === "ORGANIZER" ? {} : { teamId: session.user.teamId };

  const submissions = await prisma.submission.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    include: {
      team: { select: { name: true, track: { select: { name: true } } } },
    },
  });

  return NextResponse.json({ submissions });
}

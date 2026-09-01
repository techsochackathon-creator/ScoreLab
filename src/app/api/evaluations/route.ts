import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEvaluation } from "@/lib/eval/enqueue";

/**
 * POST /api/evaluations — organizer manually (re-)triggers evaluation.
 * Body: { submissionId }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "ORGANIZER") {
    return NextResponse.json(
      { error: "Organizer access required" },
      { status: 403 },
    );
  }

  let body: { submissionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.submissionId) {
    return NextResponse.json(
      { error: "submissionId is required" },
      { status: 400 },
    );
  }

  const submission = await prisma.submission.findUnique({
    where: { id: body.submissionId },
    include: { team: { include: { track: { select: { publishedAt: true } } } } },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  if (submission.team.track.publishedAt) {
    return NextResponse.json(
      { error: "Scores are published and locked; unpublish the track to re-evaluate." },
      { status: 423 },
    );
  }

  const jobId = await enqueueEvaluation(submission.id, "manual");
  return NextResponse.json({ ok: true, jobId }, { status: 202 });
}

/** GET /api/evaluations?submissionId=... — jobs + results (organizer or owner). */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const submissionId = new URL(req.url).searchParams.get("submissionId");
  if (!submissionId) {
    return NextResponse.json(
      { error: "submissionId is required" },
      { status: 400 },
    );
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { teamId: true },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  if (
    session.user.role !== "ORGANIZER" &&
    submission.teamId !== session.user.teamId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jobs = await prisma.evaluationJob.findMany({
    where: { submissionId },
    orderBy: { createdAt: "desc" },
    include: { results: { include: { criterion: true } } },
  });

  return NextResponse.json({ jobs });
}

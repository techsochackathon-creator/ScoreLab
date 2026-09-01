import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maxPointsFor } from "@/lib/scoringRules";

/**
 * PUT /api/submissions/[id]/human-score
 * Body: { humanScore: number | null }
 * Organizer-only. Validates against the track rubric's human_score maxScore.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  let body: { humanScore?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      team: {
        include: {
          track: { include: { rubrics: { take: 1, include: { criteria: true } } } },
        },
      },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  if (submission.team.track.publishedAt) {
    return NextResponse.json(
      { error: "Scores are published and locked; unpublish the track to edit." },
      { status: 423 },
    );
  }

  // Clearing the score.
  if (body.humanScore === null || body.humanScore === undefined) {
    await prisma.submission.update({
      where: { id },
      data: { humanScore: null },
    });
    return NextResponse.json({ ok: true, humanScore: null });
  }

  const value = Number(body.humanScore);
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json(
      { error: "humanScore must be a number >= 0" },
      { status: 400 },
    );
  }

  const humanCriterion = submission.team.track.rubrics[0]?.criteria.find(
    (c) => c.checkType === "human_score",
  );
  const maxScore = humanCriterion
    ? maxPointsFor("human_score", humanCriterion.scoringRules)
    : 10;

  if (value > maxScore) {
    return NextResponse.json(
      { error: `humanScore must be between 0 and ${maxScore}` },
      { status: 400 },
    );
  }
  if (!humanCriterion) {
    // Recorded, but there is no human_score criterion to weight it by.
    await prisma.submission.update({ where: { id }, data: { humanScore: value } });
    return NextResponse.json({
      ok: true,
      humanScore: value,
      warning:
        "Saved, but the track rubric has no human_score criterion, so it won't affect the final score until one is added.",
    });
  }

  await prisma.submission.update({ where: { id }, data: { humanScore: value } });
  return NextResponse.json({ ok: true, humanScore: value, maxScore });
}

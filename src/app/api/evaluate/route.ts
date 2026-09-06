import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import { parseRepoUrl } from "@/lib/github";
import { runEvaluation } from "@/lib/evaluate";

// GitHub fetch + one Anthropic call is synchronous; give it room.
export const maxDuration = 60;

const input = z
  .object({
    // Either start a new evaluation (teamId/teamCode + repoUrl)…
    teamId: z.string().trim().optional(),
    teamCode: z.string().trim().optional(),
    repoUrl: z.string().trim().url().optional(),
    // …or re-evaluate an existing submission.
    submissionId: z.string().trim().optional(),
  })
  .refine((v) => v.submissionId || ((v.teamId || v.teamCode) && v.repoUrl), {
    message: "Provide submissionId, or (teamId/teamCode and repoUrl)",
  });

/**
 * POST /api/evaluate
 *  - New: { teamId | teamCode, repoUrl }  → creates a submission and evaluates.
 *  - Re-run: { submissionId }             → re-evaluates in place.
 * Runs synchronously and returns the finished submission.
 */
export async function POST(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body;
  try {
    body = input.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let submissionId: string;

  if (body.submissionId) {
    const existing = await prisma.submission.findUnique({ where: { id: body.submissionId } });
    if (!existing) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    submissionId = existing.id;
  } else {
    // Validate repo URL shape up front for a clean error.
    try {
      parseRepoUrl(body.repoUrl!);
    } catch {
      return NextResponse.json({ error: "Enter a valid GitHub repository URL" }, { status: 400 });
    }

    const team = body.teamId
      ? await prisma.team.findUnique({ where: { id: body.teamId } })
      : await prisma.team.findUnique({ where: { teamCode: body.teamCode! } });
    if (!team) return NextResponse.json({ error: "Team not found (check the Team ID)" }, { status: 404 });

    const submission = await prisma.submission.create({
      data: { teamId: team.id, repoUrl: body.repoUrl!, status: "PENDING" },
    });
    submissionId = submission.id;
  }

  await runEvaluation(submissionId);

  const result = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { team: true, scores: { include: { criterion: true } } },
  });
  return NextResponse.json({ submission: result }, { status: result?.status === "FAILED" ? 200 : 201 });
}

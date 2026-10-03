import { prisma } from "@/lib/prisma";

/**
 * Remove stale failed / review-required records for a team, keeping only the
 * most recent one.  Successful evaluations (EVALUATED) are never touched.
 *
 * Runs after every evaluation attempt so failures don't pile up across retries.
 *
 * What gets cleaned:
 *   - EvaluationEvent rows with status FAILED or REVIEW_REQUIRED (older ones)
 *   - Submission rows with status FAILED or REVIEW_REQUIRED (older ones) +
 *     their CriterionScore children
 *
 * What is preserved:
 *   - The SINGLE most recent failed/review-required EvaluationEvent
 *   - The SINGLE most recent failed/review-required Submission
 *   - ALL successful (EVALUATED) records — untouched
 *   - ALL PENDING / EVALUATING records — in-flight, not touched
 */
export async function cleanupFailedRuns(teamId: string): Promise<{ deletedEvents: number; deletedSubmissions: number }> {
  let deletedEvents = 0;
  let deletedSubmissions = 0;

  // --- EvaluationEvent cleanup ---
  const failedEvents = await prisma.evaluationEvent.findMany({
    where: {
      teamId,
      status: { in: ["FAILED", "REVIEW_REQUIRED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // Keep the newest one, delete the rest.
  if (failedEvents.length > 1) {
    const idsToDelete = failedEvents.slice(1).map((e) => e.id);
    const result = await prisma.evaluationEvent.deleteMany({
      where: { id: { in: idsToDelete } },
    });
    deletedEvents = result.count;
  }

  // --- Submission cleanup ---
  const failedSubmissions = await prisma.submission.findMany({
    where: {
      teamId,
      status: { in: ["FAILED", "REVIEW_REQUIRED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // Keep the newest one, delete the rest (cascade deletes CriterionScores).
  if (failedSubmissions.length > 1) {
    const idsToDelete = failedSubmissions.slice(1).map((s) => s.id);
    // Delete criterion scores first (no cascade on Submission delete for scores).
    await prisma.criterionScore.deleteMany({
      where: { submissionId: { in: idsToDelete } },
    });
    const result = await prisma.submission.deleteMany({
      where: { id: { in: idsToDelete } },
    });
    deletedSubmissions = result.count;
  }

  return { deletedEvents, deletedSubmissions };
}

import { prisma } from "@/lib/prisma";

export type LockReason = "evaluations-started" | "manual" | null;

export interface RubricLockState {
  locked: boolean;
  reason: LockReason;
  lockedAt: string | null;
  evaluationJobs: number;
}

/**
 * A track's rubric locks once an evaluation job exists for any submission by a
 * team in that track (evaluation has started against these rules), or when an
 * organizer freezes it manually via `Rubric.lockedAt`.
 */
export async function getRubricLockState(
  trackId: string,
): Promise<RubricLockState> {
  const [rubric, evaluationJobs] = await Promise.all([
    prisma.rubric.findFirst({
      where: { trackId },
      select: { lockedAt: true },
    }),
    prisma.evaluationJob.count({
      where: { submission: { team: { trackId } } },
    }),
  ]);

  if (evaluationJobs > 0) {
    return {
      locked: true,
      reason: "evaluations-started",
      lockedAt: rubric?.lockedAt?.toISOString() ?? null,
      evaluationJobs,
    };
  }
  if (rubric?.lockedAt) {
    return {
      locked: true,
      reason: "manual",
      lockedAt: rubric.lockedAt.toISOString(),
      evaluationJobs,
    };
  }
  return { locked: false, reason: null, lockedAt: null, evaluationJobs };
}

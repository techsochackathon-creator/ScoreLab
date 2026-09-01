import { prisma } from "@/lib/prisma";
import {
  computeSubmissionScore,
  rankSubmissions,
  type CriterionInput,
  type RankedEntry,
  type SubmissionInput,
} from "@/lib/aggregation";

export interface TrackLeaderboard {
  trackId: string;
  trackName: string;
  hasRubric: boolean;
  criteria: { id: string; name: string; checkType: string; weight: number }[];
  humanMaxScore: number | null;
  entries: RankedEntry[];
}

/**
 * Build the ranked leaderboard for a track. Ranks each team's LATEST submission
 * using its latest COMPLETED evaluation job's results.
 */
export async function getTrackLeaderboard(
  trackId: string,
): Promise<TrackLeaderboard | null> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { rubrics: { take: 1, include: { criteria: true } } },
  });
  if (!track) return null;

  const rubric = track.rubrics[0];
  const criteria: CriterionInput[] = (rubric?.criteria ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    checkType: c.checkType,
    weight: c.weight,
    scoringRules: c.scoringRules,
  }));

  const teams = await prisma.team.findMany({
    where: { trackId },
    include: {
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        include: {
          evaluationJobs: {
            where: { status: "COMPLETED" },
            orderBy: { completedAt: "desc" },
            take: 1,
            include: { results: true },
          },
        },
      },
    },
  });

  const scores = teams
    .filter((t) => t.submissions.length > 0)
    .map((t) => {
      const submission = t.submissions[0];
      const job = submission.evaluationJobs[0] ?? null;
      const input: SubmissionInput = {
        submissionId: submission.id,
        teamId: t.id,
        teamName: t.name,
        university: t.university,
        humanScore: submission.humanScore,
        submittedAt: submission.submittedAt,
        jobId: job?.id ?? null,
        jobStatus: job?.status ?? null,
        results: (job?.results ?? []).map((r) => ({
          criterionId: r.criterionId,
          computedScore: r.computedScore,
          rawMetric: r.rawMetric,
        })),
      };
      return computeSubmissionScore(input, criteria);
    });

  const humanCriterion = criteria.find((c) => c.checkType === "human_score");

  return {
    trackId: track.id,
    trackName: track.name,
    hasRubric: !!rubric,
    criteria: criteria.map((c) => ({
      id: c.id,
      name: c.name,
      checkType: c.checkType,
      weight: c.weight,
    })),
    humanMaxScore: humanCriterion
      ? scores.find((s) => s.humanMaxScore != null)?.humanMaxScore ?? 10
      : null,
    entries: rankSubmissions(scores),
  };
}

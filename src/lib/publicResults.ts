import { prisma } from "@/lib/prisma";
import { maxPointsFor } from "@/lib/scoringRules";
import {
  computeSubmissionScore,
  type CriterionInput,
  type SubmissionScore,
} from "@/lib/aggregation";
import type { CriterionResultDetail } from "@/lib/dashboard";

export interface TeamResults {
  teamId: string;
  teamName: string;
  university: string;
  trackId: string;
  trackName: string;
  trackPublished: boolean;
  submittedAt: string | null;
  liveUrl: string | null;
  repoUrl: string | null;
  evaluated: boolean;
  score: SubmissionScore | null;
  humanMaxScore: number | null;
  results: CriterionResultDetail[];
}

/**
 * Team-facing results for a track's latest submission by this team: the score
 * breakdown plus per-criterion evidence (raw metrics, logs, screenshots) from
 * the latest COMPLETED job. Access control is enforced by the caller.
 */
export async function getTeamResults(
  trackId: string,
  teamId: string,
): Promise<TeamResults | null> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, trackId },
    include: {
      track: { include: { rubrics: { take: 1, include: { criteria: true } } } },
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        include: {
          evaluationJobs: {
            where: { status: "COMPLETED" },
            orderBy: { completedAt: "desc" },
            take: 1,
            include: { results: { include: { criterion: true } } },
          },
        },
      },
    },
  });
  if (!team) return null;

  const criteria: CriterionInput[] = (
    team.track.rubrics[0]?.criteria ?? []
  ).map((c) => ({
    id: c.id,
    name: c.name,
    checkType: c.checkType,
    weight: c.weight,
    scoringRules: c.scoringRules,
  }));
  const humanCriterion = criteria.find((c) => c.checkType === "human_score");

  const submission = team.submissions[0] ?? null;
  const job = submission?.evaluationJobs[0] ?? null;

  const score =
    submission && job
      ? computeSubmissionScore(
          {
            submissionId: submission.id,
            teamId: team.id,
            teamName: team.name,
            university: team.university,
            humanScore: submission.humanScore,
            submittedAt: submission.submittedAt,
            jobId: job.id,
            jobStatus: job.status,
            results: job.results.map((r) => ({
              criterionId: r.criterionId,
              computedScore: r.computedScore,
              rawMetric: r.rawMetric,
            })),
          },
          criteria,
        )
      : null;

  return {
    teamId: team.id,
    teamName: team.name,
    university: team.university,
    trackId: team.trackId,
    trackName: team.track.name,
    trackPublished: !!team.track.publishedAt,
    submittedAt: submission?.submittedAt.toISOString() ?? null,
    liveUrl: submission?.liveUrl ?? null,
    repoUrl: submission?.repoUrl ?? null,
    evaluated: !!job,
    score,
    humanMaxScore: humanCriterion
      ? maxPointsFor("human_score", humanCriterion.scoringRules)
      : null,
    results: (job?.results ?? []).map((r) => ({
      criterionId: r.criterionId,
      criterionName: r.criterion.name,
      checkType: r.criterion.checkType,
      weight: r.criterion.weight,
      rawMetric: r.rawMetric,
      computedScore: r.computedScore,
      details: r.details,
    })),
  };
}

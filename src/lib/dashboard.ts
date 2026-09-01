import { prisma } from "@/lib/prisma";
import { maxPointsFor } from "@/lib/scoringRules";
import {
  computeSubmissionScore,
  type CriterionInput,
  type SubmissionScore,
} from "@/lib/aggregation";

export interface JobSummary {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  inngestRunId: string | null;
  createdAt: string;
}

export interface DashboardEntry {
  teamId: string;
  teamName: string;
  university: string;
  submissionId: string | null;
  repoUrl: string | null;
  liveUrl: string | null;
  submittedAt: string | null;
  humanScore: number | null;
  latestJob: JobSummary | null;
  /** Only present when a COMPLETED job exists. */
  score: SubmissionScore | null;
}

export interface TrackDashboard {
  trackId: string;
  trackName: string;
  hasRubric: boolean;
  published: boolean;
  publishedAt: string | null;
  humanMaxScore: number | null;
  statusCounts: Record<string, number>;
  entries: DashboardEntry[];
}

function mapCriteria(
  criteria: { id: string; name: string; checkType: CriterionInput["checkType"]; weight: number; scoringRules: unknown }[],
): CriterionInput[] {
  return criteria.map((c) => ({
    id: c.id,
    name: c.name,
    checkType: c.checkType,
    weight: c.weight,
    scoringRules: c.scoringRules,
  }));
}

const jobSummary = (j: {
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  inngestRunId: string | null;
  createdAt: Date;
}): JobSummary => ({
  id: j.id,
  status: j.status,
  startedAt: j.startedAt?.toISOString() ?? null,
  completedAt: j.completedAt?.toISOString() ?? null,
  error: j.error,
  inngestRunId: j.inngestRunId,
  createdAt: j.createdAt.toISOString(),
});

/** Per-track dashboard: every team's latest submission, its latest job status,
 *  and (if completed) its computed score. */
export async function getTrackDashboard(
  trackId: string,
): Promise<TrackDashboard | null> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { rubrics: { take: 1, include: { criteria: true } } },
  });
  if (!track) return null;

  const rubric = track.rubrics[0];
  const criteria = mapCriteria(rubric?.criteria ?? []);
  const humanCriterion = criteria.find((c) => c.checkType === "human_score");

  const teams = await prisma.team.findMany({
    where: { trackId },
    orderBy: { name: "asc" },
    include: {
      submissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        include: {
          evaluationJobs: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { results: true },
          },
        },
      },
    },
  });

  const statusCounts: Record<string, number> = {
    QUEUED: 0,
    RUNNING: 0,
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
    none: 0,
  };

  const entries: DashboardEntry[] = teams.map((t) => {
    const submission = t.submissions[0] ?? null;
    const jobs = submission?.evaluationJobs ?? [];
    const latest = jobs[0] ?? null;
    const completed = jobs.find((j) => j.status === "COMPLETED") ?? null;

    if (latest) statusCounts[latest.status] = (statusCounts[latest.status] ?? 0) + 1;
    else statusCounts.none += 1;

    let score: SubmissionScore | null = null;
    if (submission && completed) {
      score = computeSubmissionScore(
        {
          submissionId: submission.id,
          teamId: t.id,
          teamName: t.name,
          university: t.university,
          humanScore: submission.humanScore,
          submittedAt: submission.submittedAt,
          jobId: completed.id,
          jobStatus: completed.status,
          results: completed.results.map((r) => ({
            criterionId: r.criterionId,
            computedScore: r.computedScore,
            rawMetric: r.rawMetric,
          })),
        },
        criteria,
      );
    }

    return {
      teamId: t.id,
      teamName: t.name,
      university: t.university,
      submissionId: submission?.id ?? null,
      repoUrl: submission?.repoUrl ?? null,
      liveUrl: submission?.liveUrl ?? null,
      submittedAt: submission?.submittedAt.toISOString() ?? null,
      humanScore: submission?.humanScore ?? null,
      latestJob: latest ? jobSummary(latest) : null,
      score,
    };
  });

  return {
    trackId: track.id,
    trackName: track.name,
    hasRubric: !!rubric,
    published: !!track.publishedAt,
    publishedAt: track.publishedAt?.toISOString() ?? null,
    humanMaxScore: humanCriterion
      ? maxPointsFor("human_score", humanCriterion.scoringRules)
      : null,
    statusCounts,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Per-submission detail
// ---------------------------------------------------------------------------

export interface CriterionResultDetail {
  criterionId: string;
  criterionName: string;
  checkType: string;
  weight: number;
  rawMetric: number | null;
  computedScore: number | null;
  details: unknown;
}

export interface JobDetail extends JobSummary {
  results: CriterionResultDetail[];
}

export interface SubmissionDetail {
  submissionId: string;
  repoUrl: string;
  liveUrl: string | null;
  pitchDeckBlobUrl: string | null;
  submittedAt: string;
  humanScore: number | null;
  team: {
    id: string;
    name: string;
    university: string;
    trackId: string;
    trackName: string;
  };
  published: boolean;
  humanMaxScore: number | null;
  jobs: JobDetail[];
  /** Score from the latest COMPLETED job. */
  score: SubmissionScore | null;
}

export async function getSubmissionDetail(
  submissionId: string,
): Promise<SubmissionDetail | null> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      team: {
        include: {
          track: { include: { rubrics: { take: 1, include: { criteria: true } } } },
        },
      },
      evaluationJobs: {
        orderBy: { createdAt: "desc" },
        include: { results: { include: { criterion: true } } },
      },
    },
  });
  if (!sub) return null;

  const criteria = mapCriteria(sub.team.track.rubrics[0]?.criteria ?? []);
  const humanCriterion = criteria.find((c) => c.checkType === "human_score");
  const completed = sub.evaluationJobs.find((j) => j.status === "COMPLETED") ?? null;

  const score = completed
    ? computeSubmissionScore(
        {
          submissionId: sub.id,
          teamId: sub.team.id,
          teamName: sub.team.name,
          university: sub.team.university,
          humanScore: sub.humanScore,
          submittedAt: sub.submittedAt,
          jobId: completed.id,
          jobStatus: completed.status,
          results: completed.results.map((r) => ({
            criterionId: r.criterionId,
            computedScore: r.computedScore,
            rawMetric: r.rawMetric,
          })),
        },
        criteria,
      )
    : null;

  return {
    submissionId: sub.id,
    repoUrl: sub.repoUrl,
    liveUrl: sub.liveUrl,
    pitchDeckBlobUrl: sub.pitchDeckBlobUrl,
    submittedAt: sub.submittedAt.toISOString(),
    humanScore: sub.humanScore,
    team: {
      id: sub.team.id,
      name: sub.team.name,
      university: sub.team.university,
      trackId: sub.team.trackId,
      trackName: sub.team.track.name,
    },
    published: !!sub.team.track.publishedAt,
    humanMaxScore: humanCriterion
      ? maxPointsFor("human_score", humanCriterion.scoringRules)
      : null,
    jobs: sub.evaluationJobs.map((j) => ({
      ...jobSummary(j),
      results: j.results.map((r) => ({
        criterionId: r.criterionId,
        criterionName: r.criterion.name,
        checkType: r.criterion.checkType,
        weight: r.criterion.weight,
        rawMetric: r.rawMetric,
        computedScore: r.computedScore,
        details: r.details,
      })),
    })),
    score,
  };
}

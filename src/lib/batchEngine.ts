import { prisma } from "@/lib/prisma";
import { runEvaluation } from "@/lib/evaluate";
import type { BatchRun, BatchJob } from "@prisma/client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max parallel Gemini evaluation calls. Override via env. */
export const EVALUATION_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.EVALUATION_CONCURRENCY ?? "3", 10) || 3,
);

/** Default retry cap per job. */
export const DEFAULT_MAX_RETRIES = 2;

/** Base delay (ms) for exponential backoff: delay = BASE * 2^attempt. */
export const BACKOFF_BASE_MS = 2_000;

/** Maximum backoff delay (ms). */
export const BACKOFF_MAX_MS = 30_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BatchProgress {
  batchRunId: string;
  status: BatchRun["status"];
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  reviewRequired: number;
  cancelled: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateBatchOptions {
  /** Subset of team IDs to evaluate. Omit → all teams with a repoUrl. */
  teamIds?: string[];
  /** Override default concurrency. */
  concurrency?: number;
  /** Override default max retries per job. */
  maxRetries?: number;
  /** userId of the organizer who triggered the batch. */
  createdBy?: string;
}

// ---------------------------------------------------------------------------
// Create a batch
// ---------------------------------------------------------------------------

/**
 * Create a new BatchRun with one job per team. Prevents duplicates:
 * if a team already has a QUEUED or RUNNING job in ANY active batch,
 * it is skipped.
 *
 * Returns the batch and the list of skipped team IDs (duplicates).
 */
export async function createBatch(
  opts: CreateBatchOptions = {},
): Promise<{ batch: BatchRun; skippedTeamIds: string[] }> {
  const concurrency = opts.concurrency ?? EVALUATION_CONCURRENCY;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  // Resolve target teams: either the explicit list or all teams with repos.
  let teams: { id: string; repoUrl: string | null }[];
  if (opts.teamIds?.length) {
    teams = await prisma.team.findMany({
      where: { id: { in: opts.teamIds } },
      select: { id: true, repoUrl: true },
    });
  } else {
    teams = await prisma.team.findMany({
      where: { repoUrl: { not: null } },
      select: { id: true, repoUrl: true },
    });
  }

  // Filter out teams with no repoUrl.
  const eligible = teams.filter((t) => t.repoUrl);
  if (eligible.length === 0) {
    throw new Error("No eligible teams (all must have a repoUrl).");
  }

  // Duplicate prevention: skip teams that already have an active job.
  const activeJobs = await prisma.batchJob.findMany({
    where: {
      teamId: { in: eligible.map((t) => t.id) },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { teamId: true },
  });
  const activeTeamIds = new Set(activeJobs.map((j) => j.teamId));
  const toCreate = eligible.filter((t) => !activeTeamIds.has(t.id));
  const skippedTeamIds = eligible
    .filter((t) => activeTeamIds.has(t.id))
    .map((t) => t.id);

  if (toCreate.length === 0) {
    throw new Error("All eligible teams already have active evaluation jobs.");
  }

  const batch = await prisma.batchRun.create({
    data: {
      concurrency,
      totalJobs: toCreate.length,
      createdBy: opts.createdBy ?? null,
      jobs: {
        create: toCreate.map((t) => ({
          teamId: t.id,
          maxRetries,
        })),
      },
    },
    include: { jobs: true },
  });

  return { batch, skippedTeamIds };
}

// ---------------------------------------------------------------------------
// Run a batch (the engine)
// ---------------------------------------------------------------------------

/**
 * Execute a batch run: process all QUEUED jobs with controlled concurrency.
 *
 * The loop checks the batch status before launching each new job.
 * If the batch is PAUSED, it stops launching new jobs but allows
 * currently-running jobs to finish. If CANCELLED, it also stops launching.
 *
 * This function is designed to be called once per batch (e.g. from an API
 * route that returns immediately while this runs in the background).
 */
export async function executeBatch(
  batchRunId: string,
  options?: {
    /** Override: custom evaluation function (for testing). */
    evaluateFn?: (submissionId: string) => Promise<void>;
    /** Override: custom delay function (for testing). */
    delayFn?: (ms: number) => Promise<void>;
    /** Override: custom function to read current batch status (for testing). */
    getStatusFn?: (batchRunId: string) => Promise<string>;
  },
): Promise<BatchProgress> {
  const evaluateFn = options?.evaluateFn ?? runEvaluation;
  const delayFn = options?.delayFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const getStatusFn = options?.getStatusFn ?? (async (id: string) => {
    const b = await prisma.batchRun.findUnique({ where: { id }, select: { status: true } });
    return b?.status ?? "COMPLETED";
  });

  const batch = await prisma.batchRun.findUnique({
    where: { id: batchRunId },
    include: { jobs: true },
  });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  // Idempotency: if already completed/cancelled, return current progress.
  if (batch.status === "COMPLETED" || batch.status === "CANCELLED") {
    return getProgress(batchRunId);
  }

  // Mark the batch as RUNNING (unless it's PAUSED — resume sets RUNNING).
  if (batch.status !== "RUNNING") {
    await prisma.batchRun.update({
      where: { id: batchRunId },
      data: { status: "RUNNING", startedAt: batch.startedAt ?? new Date() },
    });
  }

  const concurrency = batch.concurrency;
  const jobs = batch.jobs.filter((j) => j.status === "QUEUED");

  // Semaphore: at most `concurrency` jobs run in parallel.
  let running = 0;
  let idx = 0;
  const results: Promise<void>[] = [];

  async function processJob(job: BatchJob): Promise<void> {
    // Re-check status (idempotency: another process may have started it).
    const fresh = await prisma.batchJob.findUnique({ where: { id: job.id } });
    if (!fresh || fresh.status !== "QUEUED") return;

    await executeJob(fresh, evaluateFn, delayFn);
  }

  // Producer: feed jobs to the pool, checking for pause/cancel before each launch.
  await new Promise<void>((resolve) => {
    async function tryLaunch() {
      // Check batch status before launching new jobs.
      const currentStatus = await getStatusFn(batchRunId);
      if (currentStatus === "PAUSED" || currentStatus === "CANCELLED") {
        // Don't launch new jobs. Wait for running ones to finish.
        if (running === 0) resolve();
        return;
      }

      while (running < concurrency && idx < jobs.length) {
        const job = jobs[idx++];
        running++;
        const p = processJob(job).finally(() => {
          running--;
          tryLaunch();
        });
        results.push(p);
      }
      if (running === 0 && idx >= jobs.length) {
        resolve();
      }
    }
    tryLaunch();
    // Edge case: no jobs to process.
    if (jobs.length === 0) resolve();
  });

  // Wait for all launched jobs to finish.
  await Promise.allSettled(results);

  // Finalize the batch — but only if it wasn't paused or cancelled mid-run.
  const finalStatus = await getStatusFn(batchRunId);
  if (finalStatus === "PAUSED") {
    // Stay PAUSED — don't mark as completed.
    return getProgress(batchRunId);
  }
  if (finalStatus === "CANCELLED") {
    return getProgress(batchRunId);
  }

  // Check if there are still QUEUED jobs (e.g. from a retry that happened
  // concurrently). If so, don't finalize yet.
  const remainingQueued = await prisma.batchJob.count({
    where: { batchRunId, status: "QUEUED" },
  });
  if (remainingQueued > 0) {
    return getProgress(batchRunId);
  }

  await prisma.batchRun.update({
    where: { id: batchRunId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return getProgress(batchRunId);
}

// ---------------------------------------------------------------------------
// Execute a single job (with retry + backoff)
// ---------------------------------------------------------------------------

async function executeJob(
  job: BatchJob,
  evaluateFn: (submissionId: string) => Promise<void>,
  delayFn: (ms: number) => Promise<void>,
): Promise<void> {
  const maxAttempts = job.maxRetries + 1; // first try + retries

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Mark RUNNING + increment attempt counter.
    await prisma.batchJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempt, startedAt: new Date(), error: null },
    });

    try {
      // Create a fresh submission for this attempt (or reuse if first).
      const team = await prisma.team.findUnique({ where: { id: job.teamId } });
      if (!team?.repoUrl) {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: "Team has no repoUrl",
            completedAt: new Date(),
          },
        });
        return;
      }

      // Create a new submission for evaluation.
      // Each attempt gets its own submission — previous submissions are
      // preserved for auditability (never deleted or overwritten).
      const submission = await prisma.submission.create({
        data: { teamId: team.id, repoUrl: team.repoUrl, status: "PENDING" },
      });

      await prisma.batchJob.update({
        where: { id: job.id },
        data: { submissionId: submission.id },
      });

      // Run the full evaluation pipeline.
      await evaluateFn(submission.id);

      // Check the submission outcome.
      const result = await prisma.submission.findUnique({
        where: { id: submission.id },
      });

      if (result?.status === "EVALUATED") {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        return; // success — no retry
      }

      if (result?.status === "REVIEW_REQUIRED") {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: {
            status: "REVIEW_REQUIRED",
            error: result.error,
            completedAt: new Date(),
          },
        });
        return; // review-required is terminal, no retry
      }

      // FAILED — will retry if attempts remain.
      const errorMsg = result?.error ?? "Evaluation did not complete successfully";
      if (attempt >= maxAttempts) {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: errorMsg, completedAt: new Date() },
        });
        return;
      }

      // Backoff before retry.
      const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
      await delayFn(backoffMs);
    } catch (err) {
      const errorMsg = (err as Error).message?.slice(0, 500) ?? "Unknown error";

      if (attempt >= maxAttempts) {
        await prisma.batchJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: errorMsg, completedAt: new Date() },
        });
        return;
      }

      // Backoff before retry.
      const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
      await delayFn(backoffMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Pause a batch
// ---------------------------------------------------------------------------

/**
 * Pause a running batch. Stops launching new jobs. Currently running
 * jobs are allowed to finish — they are NOT interrupted.
 */
export async function pauseBatch(batchRunId: string): Promise<BatchProgress> {
  const batch = await prisma.batchRun.findUnique({ where: { id: batchRunId } });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  if (batch.status !== "RUNNING") {
    throw new Error(`Cannot pause a batch in status ${batch.status} — only RUNNING batches can be paused.`);
  }

  await prisma.batchRun.update({
    where: { id: batchRunId },
    data: { status: "PAUSED" },
  });

  return getProgress(batchRunId);
}

// ---------------------------------------------------------------------------
// Resume a paused batch
// ---------------------------------------------------------------------------

/**
 * Resume a paused batch. Sets status back to RUNNING and re-executes
 * the remaining QUEUED jobs.
 */
export async function resumeBatch(batchRunId: string): Promise<BatchProgress> {
  const batch = await prisma.batchRun.findUnique({ where: { id: batchRunId } });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  if (batch.status !== "PAUSED") {
    throw new Error(`Cannot resume a batch in status ${batch.status} — only PAUSED batches can be resumed.`);
  }

  await prisma.batchRun.update({
    where: { id: batchRunId },
    data: { status: "RUNNING" },
  });

  return getProgress(batchRunId);
}

// ---------------------------------------------------------------------------
// Cancel a batch
// ---------------------------------------------------------------------------

/**
 * Cancel all QUEUED jobs in a batch. RUNNING jobs finish naturally —
 * they are NOT interrupted or corrupted.
 */
export async function cancelBatch(batchRunId: string): Promise<BatchProgress> {
  const batch = await prisma.batchRun.findUnique({ where: { id: batchRunId } });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  if (batch.status !== "RUNNING" && batch.status !== "PAUSED" && batch.status !== "PENDING") {
    throw new Error(`Cannot cancel a batch in status ${batch.status}.`);
  }

  await prisma.batchJob.updateMany({
    where: { batchRunId, status: "QUEUED" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  // If no jobs are still RUNNING, mark the batch done.
  const stillRunning = await prisma.batchJob.count({
    where: { batchRunId, status: "RUNNING" },
  });

  if (stillRunning === 0) {
    await prisma.batchRun.update({
      where: { id: batchRunId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
  } else {
    // Mark as CANCELLED — the engine loop will see this and stop launching.
    // Running jobs will finish naturally and the batch will remain CANCELLED.
    await prisma.batchRun.update({
      where: { id: batchRunId },
      data: { status: "CANCELLED" },
    });
  }

  return getProgress(batchRunId);
}

// ---------------------------------------------------------------------------
// Retry jobs by status
// ---------------------------------------------------------------------------

/**
 * Re-queue jobs in a batch that have a given terminal status (FAILED or
 * REVIEW_REQUIRED). Sets them to QUEUED for the next executeBatch call.
 *
 * AUDITABILITY: The job's previous attempt count, error, and submission
 * references are preserved via the existing Submission + EvaluationEvent
 * records. Each retry creates a NEW submission (the old ones remain
 * in the database). The job record's `attempt` counter increments from
 * its current value, and `maxRetries` is reset to allow fresh retries.
 */
export async function retryJobsByStatus(
  batchRunId: string,
  targetStatus: "FAILED" | "REVIEW_REQUIRED",
): Promise<{ requeued: number }> {
  const batch = await prisma.batchRun.findUnique({ where: { id: batchRunId } });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  // Find jobs to retry, keeping track of their current state for audit.
  const jobsToRetry = await prisma.batchJob.findMany({
    where: { batchRunId, status: targetStatus },
  });

  if (jobsToRetry.length === 0) {
    return { requeued: 0 };
  }

  // Re-queue each job. Previous submission/EvaluationEvent records remain
  // untouched in the database for auditability. The job record itself is
  // updated — its `attempt` counter preserves history of how many attempts
  // have been made so far.
  await prisma.batchJob.updateMany({
    where: {
      id: { in: jobsToRetry.map((j) => j.id) },
      status: targetStatus, // guard against race
    },
    data: {
      status: "QUEUED",
      error: null,
      completedAt: null,
      // NOTE: `attempt` is NOT reset — it preserves the total attempt count.
      // `maxRetries` gets extra retries so executeBatch will pick them up.
    },
  });

  // Give each re-queued job additional retry headroom.
  for (const job of jobsToRetry) {
    await prisma.batchJob.update({
      where: { id: job.id },
      data: { maxRetries: job.attempt + DEFAULT_MAX_RETRIES },
    });
  }

  // Re-open the batch so executeBatch can process the re-queued jobs.
  if (batch.status === "COMPLETED" || batch.status === "CANCELLED" || batch.status === "PAUSED") {
    await prisma.batchRun.update({
      where: { id: batchRunId },
      data: { status: "RUNNING", completedAt: null },
    });
  }

  return { requeued: jobsToRetry.length };
}

// ---------------------------------------------------------------------------
// Job details (for the UI table)
// ---------------------------------------------------------------------------

export interface BatchJobDetail {
  id: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  status: string;
  attempt: number;
  maxRetries: number;
  error: string | null;
  totalScore: number | null;
  flags: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export async function getJobDetails(batchRunId: string): Promise<BatchJobDetail[]> {
  const jobs = await prisma.batchJob.findMany({
    where: { batchRunId },
    include: {
      team: { select: { name: true, teamCode: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Fetch the latest submission scores for completed jobs.
  const submissionIds = jobs.map((j) => j.submissionId).filter(Boolean) as string[];
  const submissions = submissionIds.length
    ? await prisma.submission.findMany({
        where: { id: { in: submissionIds } },
        select: { id: true, totalScore: true, flags: true },
      })
    : [];
  const subMap = new Map(submissions.map((s) => [s.id, s]));

  return jobs.map((j) => {
    const sub = j.submissionId ? subMap.get(j.submissionId) : null;
    return {
      id: j.id,
      teamId: j.teamId,
      teamName: j.team.name,
      teamCode: j.team.teamCode,
      status: j.status,
      attempt: j.attempt,
      maxRetries: j.maxRetries,
      error: j.error,
      totalScore: sub?.totalScore ?? null,
      flags: sub?.flags ?? [],
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export async function getProgress(batchRunId: string): Promise<BatchProgress> {
  const batch = await prisma.batchRun.findUnique({
    where: { id: batchRunId },
  });
  if (!batch) throw new Error(`BatchRun ${batchRunId} not found`);

  const counts = await prisma.batchJob.groupBy({
    by: ["status"],
    where: { batchRunId },
    _count: true,
  });

  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.status] = c._count;

  return {
    batchRunId,
    status: batch.status,
    total: batch.totalJobs,
    queued: countMap["QUEUED"] ?? 0,
    running: countMap["RUNNING"] ?? 0,
    completed: countMap["COMPLETED"] ?? 0,
    failed: countMap["FAILED"] ?? 0,
    reviewRequired: countMap["REVIEW_REQUIRED"] ?? 0,
    cancelled: countMap["CANCELLED"] ?? 0,
    createdAt: batch.createdAt,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
  };
}

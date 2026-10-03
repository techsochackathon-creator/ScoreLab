/**
 * Unit tests for the batch evaluation engine.
 *
 * These tests exercise the engine logic in isolation using in-memory state
 * and mock functions — they do NOT hit the real database or Gemini API.
 *
 * The tests validate:
 *   1. Duplicate prevention (skip teams with active jobs)
 *   2. Concurrency limit (never exceeds configured parallelism)
 *   3. Retry with exponential backoff
 *   4. Failed / review-required / successful job handling
 *   5. Cancellation (QUEUED cancelled, RUNNING finishes)
 *   6. Pause (stops new launches, running finishes)
 *   7. Resume (continues queued jobs)
 *   8. Retry failed / retry review-required
 *   9. Idempotent batch execution
 *  10. Progress tracking
 *  11. Previous attempts preserved for auditability
 *  12. State transition guards
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// In-memory database simulation
// ---------------------------------------------------------------------------

interface MockTeam {
  id: string;
  repoUrl: string | null;
}

interface MockSubmission {
  id: string;
  teamId: string;
  repoUrl: string;
  status: "PENDING" | "EVALUATING" | "EVALUATED" | "FAILED" | "REVIEW_REQUIRED";
  error: string | null;
}

interface MockBatchJob {
  id: string;
  batchRunId: string;
  teamId: string;
  submissionId: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "REVIEW_REQUIRED" | "CANCELLED";
  attempt: number;
  maxRetries: number;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

type BatchStatusType = "PENDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";

interface MockBatchRun {
  id: string;
  status: BatchStatusType;
  concurrency: number;
  totalJobs: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

let teams: MockTeam[] = [];
let submissions: MockSubmission[] = [];
let batchRuns: MockBatchRun[] = [];
let batchJobs: MockBatchJob[] = [];
let nextId = 1;

function genId() {
  return `mock_${nextId++}`;
}

// ---------------------------------------------------------------------------
// Lightweight engine replica (mirrors batchEngine.ts logic, no Prisma)
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

function createBatchMock(opts: {
  teamIds?: string[];
  concurrency?: number;
  maxRetries?: number;
}): { batch: MockBatchRun; skippedTeamIds: string[] } {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  const eligible = opts.teamIds
    ? teams.filter((t) => opts.teamIds!.includes(t.id) && t.repoUrl)
    : teams.filter((t) => t.repoUrl);

  if (eligible.length === 0) throw new Error("No eligible teams");

  // Duplicate prevention.
  const activeTeamIds = new Set(
    batchJobs
      .filter((j) => (j.status === "QUEUED" || j.status === "RUNNING") && eligible.some((t) => t.id === j.teamId))
      .map((j) => j.teamId),
  );
  const toCreate = eligible.filter((t) => !activeTeamIds.has(t.id));
  const skippedTeamIds = eligible.filter((t) => activeTeamIds.has(t.id)).map((t) => t.id);

  if (toCreate.length === 0) throw new Error("All eligible teams already have active evaluation jobs.");

  const batch: MockBatchRun = {
    id: genId(),
    status: "PENDING",
    concurrency,
    totalJobs: toCreate.length,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
  };
  batchRuns.push(batch);

  for (const t of toCreate) {
    batchJobs.push({
      id: genId(),
      batchRunId: batch.id,
      teamId: t.id,
      submissionId: null,
      status: "QUEUED",
      attempt: 0,
      maxRetries,
      error: null,
      startedAt: null,
      completedAt: null,
    });
  }

  return { batch, skippedTeamIds };
}

type EvalOutcome = "EVALUATED" | "FAILED" | "REVIEW_REQUIRED";
type EvalFn = (submissionId: string) => Promise<void>;

/**
 * Execute a batch with pause/cancel awareness.
 * The getStatusFn is checked before launching each new job.
 */
async function executeBatchMock(
  batchRunId: string,
  evaluateFn: EvalFn,
  delayFn: (ms: number) => Promise<void>,
  getStatusFn?: () => BatchStatusType,
): Promise<MockBatchRun> {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");
  if (batch.status === "COMPLETED" || batch.status === "CANCELLED") return batch;

  if (batch.status !== "RUNNING") {
    batch.status = "RUNNING";
    batch.startedAt = batch.startedAt ?? new Date();
  }

  const jobs = batchJobs.filter((j) => j.batchRunId === batchRunId && j.status === "QUEUED");
  const concurrency = batch.concurrency;
  const checkStatus = getStatusFn ?? (() => batch.status);

  let running = 0;
  let idx = 0;
  const results: Promise<void>[] = [];

  await new Promise<void>((resolve) => {
    function tryLaunch() {
      // Check for pause/cancel before launching new jobs.
      const currentStatus = checkStatus();
      if (currentStatus === "PAUSED" || currentStatus === "CANCELLED") {
        if (running === 0) resolve();
        return;
      }

      while (running < concurrency && idx < jobs.length) {
        const job = jobs[idx++];
        running++;
        const p = executeJobMock(job, evaluateFn, delayFn).finally(() => {
          running--;
          tryLaunch();
        });
        results.push(p);
      }
      if (running === 0 && idx >= jobs.length) resolve();
    }
    tryLaunch();
    if (jobs.length === 0) resolve();
  });

  await Promise.allSettled(results);

  // Finalize — only if not paused or cancelled.
  const finalStatus = checkStatus();
  if (finalStatus === "PAUSED" || finalStatus === "CANCELLED") {
    return batch;
  }

  // Check for remaining QUEUED jobs (from concurrent retries).
  const remainingQueued = batchJobs.filter(
    (j) => j.batchRunId === batchRunId && j.status === "QUEUED",
  ).length;
  if (remainingQueued > 0) return batch;

  batch.status = "COMPLETED";
  batch.completedAt = new Date();
  return batch;
}

async function executeJobMock(
  job: MockBatchJob,
  evaluateFn: EvalFn,
  delayFn: (ms: number) => Promise<void>,
): Promise<void> {
  if (job.status !== "QUEUED") return;

  const maxAttempts = job.maxRetries + 1;
  // Start from the current attempt (which may be > 0 after a retry).
  const startAttempt = job.attempt + 1;

  for (let attempt = startAttempt; attempt <= maxAttempts; attempt++) {
    job.status = "RUNNING";
    job.attempt = attempt;
    job.startedAt = new Date();
    job.error = null;

    try {
      const team = teams.find((t) => t.id === job.teamId);
      if (!team?.repoUrl) {
        job.status = "FAILED";
        job.error = "Team has no repoUrl";
        job.completedAt = new Date();
        return;
      }

      const sub: MockSubmission = {
        id: genId(),
        teamId: team.id,
        repoUrl: team.repoUrl,
        status: "PENDING",
        error: null,
      };
      submissions.push(sub);
      job.submissionId = sub.id;

      await evaluateFn(sub.id);

      if (sub.status === "EVALUATED") {
        job.status = "COMPLETED";
        job.completedAt = new Date();
        return;
      }

      if (sub.status === "REVIEW_REQUIRED") {
        job.status = "REVIEW_REQUIRED";
        job.error = sub.error;
        job.completedAt = new Date();
        return;
      }

      const errorMsg = sub.error ?? "Evaluation did not complete";
      if (attempt >= maxAttempts) {
        job.status = "FAILED";
        job.error = errorMsg;
        job.completedAt = new Date();
        return;
      }

      const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
      await delayFn(backoffMs);
    } catch (err) {
      const errorMsg = (err as Error).message?.slice(0, 500) ?? "Unknown error";
      if (attempt >= maxAttempts) {
        job.status = "FAILED";
        job.error = errorMsg;
        job.completedAt = new Date();
        return;
      }
      const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
      await delayFn(backoffMs);
    }
  }
}

function pauseBatchMock(batchRunId: string): void {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "RUNNING") {
    throw new Error(`Cannot pause a batch in status ${batch.status}`);
  }
  batch.status = "PAUSED";
}

function resumeBatchMock(batchRunId: string): void {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "PAUSED") {
    throw new Error(`Cannot resume a batch in status ${batch.status}`);
  }
  batch.status = "RUNNING";
}

function cancelBatchMock(batchRunId: string): void {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");

  // Cancel all QUEUED jobs.
  const queuedJobs = batchJobs.filter((j) => j.batchRunId === batchRunId && j.status === "QUEUED");
  for (const j of queuedJobs) {
    j.status = "CANCELLED";
    j.completedAt = new Date();
  }

  // If no RUNNING jobs, mark batch CANCELLED immediately.
  const stillRunning = batchJobs.some(
    (j) => j.batchRunId === batchRunId && j.status === "RUNNING",
  );
  batch.status = "CANCELLED";
  if (!stillRunning) {
    batch.completedAt = new Date();
  }
}

/**
 * Retry jobs by status — mirrors the real engine's retryJobsByStatus.
 * Previous attempts are preserved: attempt counter is NOT reset.
 */
function retryJobsByStatusMock(
  batchRunId: string,
  targetStatus: "FAILED" | "REVIEW_REQUIRED",
): { requeued: number; previousAttempts: number[] } {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");

  const jobsToRetry = batchJobs.filter(
    (j) => j.batchRunId === batchRunId && j.status === targetStatus,
  );

  const previousAttempts = jobsToRetry.map((j) => j.attempt);

  for (const job of jobsToRetry) {
    job.status = "QUEUED";
    job.error = null;
    job.completedAt = null;
    // attempt is NOT reset — preserves history.
    // maxRetries gets extra headroom.
    job.maxRetries = job.attempt + DEFAULT_MAX_RETRIES;
  }

  if (jobsToRetry.length > 0 && (batch.status === "COMPLETED" || batch.status === "CANCELLED" || batch.status === "PAUSED")) {
    batch.status = "RUNNING";
    batch.completedAt = null;
  }

  return { requeued: jobsToRetry.length, previousAttempts };
}

function getProgressMock(batchRunId: string) {
  const batch = batchRuns.find((b) => b.id === batchRunId);
  if (!batch) throw new Error("Batch not found");
  const jobs = batchJobs.filter((j) => j.batchRunId === batchRunId);
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  return {
    batchRunId,
    status: batch.status,
    total: batch.totalJobs,
    queued: count("QUEUED"),
    running: count("RUNNING"),
    completed: count("COMPLETED"),
    failed: count("FAILED"),
    reviewRequired: count("REVIEW_REQUIRED"),
    cancelled: count("CANCELLED"),
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function seedTeams(n: number): MockTeam[] {
  const created: MockTeam[] = [];
  for (let i = 0; i < n; i++) {
    const t: MockTeam = { id: `team_${i + 1}`, repoUrl: `https://github.com/org/repo-${i + 1}` };
    teams.push(t);
    created.push(t);
  }
  return created;
}

function makeEvalFn(outcomes: Map<string, EvalOutcome>): EvalFn {
  return async (subId) => {
    const sub = submissions.find((s) => s.id === subId);
    if (!sub) return;
    const teamOutcome = outcomes.get(sub.teamId) ?? "EVALUATED";
    sub.status = teamOutcome;
    if (teamOutcome === "FAILED") sub.error = "Simulated failure";
    if (teamOutcome === "REVIEW_REQUIRED") sub.error = "Needs review";
  };
}

const instantDelay = async (_ms: number) => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  teams = [];
  submissions = [];
  batchRuns = [];
  batchJobs = [];
  nextId = 1;
});

describe("batch creation", () => {
  test("creates one job per team with repoUrl", () => {
    seedTeams(5);
    const { batch } = createBatchMock({});
    assert.equal(batch.totalJobs, 5);
    const jobs = batchJobs.filter((j) => j.batchRunId === batch.id);
    assert.equal(jobs.length, 5);
    assert.ok(jobs.every((j) => j.status === "QUEUED"));
  });

  test("skips teams without repoUrl", () => {
    seedTeams(3);
    teams[1].repoUrl = null;
    const { batch } = createBatchMock({});
    assert.equal(batch.totalJobs, 2);
  });

  test("accepts a subset of teamIds", () => {
    seedTeams(5);
    const { batch } = createBatchMock({ teamIds: ["team_1", "team_3"] });
    assert.equal(batch.totalJobs, 2);
    const jobTeamIds = batchJobs.filter((j) => j.batchRunId === batch.id).map((j) => j.teamId);
    assert.deepEqual(jobTeamIds.sort(), ["team_1", "team_3"]);
  });
});

describe("duplicate prevention", () => {
  test("skips teams that already have QUEUED jobs", () => {
    seedTeams(4);
    const { batch: b1 } = createBatchMock({ teamIds: ["team_1", "team_2"] });
    assert.equal(b1.totalJobs, 2);

    const { batch: b2, skippedTeamIds } = createBatchMock({});
    assert.deepEqual(skippedTeamIds.sort(), ["team_1", "team_2"]);
    assert.equal(b2.totalJobs, 2);
  });

  test("throws when all teams are already active", () => {
    seedTeams(2);
    createBatchMock({});
    assert.throws(() => createBatchMock({}), /already have active/);
  });

  test("allows teams whose prior jobs completed", () => {
    seedTeams(2);
    const { batch: b1 } = createBatchMock({});
    for (const j of batchJobs.filter((j) => j.batchRunId === b1.id)) j.status = "COMPLETED";

    const { batch: b2 } = createBatchMock({});
    assert.equal(b2.totalJobs, 2);
  });

  test("skips teams with RUNNING jobs across batches", () => {
    seedTeams(3);
    const { batch: b1 } = createBatchMock({ teamIds: ["team_1"] });
    // Simulate team_1's job as RUNNING.
    batchJobs.find((j) => j.batchRunId === b1.id && j.teamId === "team_1")!.status = "RUNNING";

    const { batch: b2, skippedTeamIds } = createBatchMock({});
    assert.deepEqual(skippedTeamIds, ["team_1"]);
    assert.equal(b2.totalJobs, 2);
  });
});

describe("concurrency limit", () => {
  test("never exceeds configured concurrency", async () => {
    seedTeams(6);
    const concurrency = 2;
    const { batch } = createBatchMock({ concurrency });

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const evalFn: EvalFn = async (subId) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 10));
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
      currentConcurrent--;
    };

    await executeBatchMock(batch.id, evalFn, instantDelay);
    assert.ok(maxConcurrent <= concurrency, `max concurrent ${maxConcurrent} exceeded limit ${concurrency}`);
    assert.ok(maxConcurrent > 0);
  });

  test("defaults to 3 concurrency", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    assert.equal(batch.concurrency, DEFAULT_CONCURRENCY);
  });
});

describe("retry with exponential backoff", () => {
  test("retries failed jobs up to maxRetries", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 2 });

    let callCount = 0;
    const evalFn: EvalFn = async (subId) => {
      callCount++;
      const sub = submissions.find((s) => s.id === subId);
      if (!sub) return;
      if (callCount < 3) {
        sub.status = "FAILED";
        sub.error = `Attempt ${callCount} failed`;
      } else {
        sub.status = "EVALUATED";
      }
    };

    await executeBatchMock(batch.id, evalFn, instantDelay);
    assert.equal(callCount, 3);

    const job = batchJobs.find((j) => j.batchRunId === batch.id);
    assert.equal(job!.status, "COMPLETED");
  });

  test("applies exponential backoff delays", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 2 });

    const delays: number[] = [];
    const delayFn = async (ms: number) => { delays.push(ms); };

    const evalFn: EvalFn = async (subId) => {
      const sub = submissions.find((s) => s.id === subId);
      if (sub) { sub.status = "FAILED"; sub.error = "always fails"; }
    };

    await executeBatchMock(batch.id, evalFn, delayFn);
    assert.equal(delays.length, 2);
    assert.equal(delays[0], BACKOFF_BASE_MS);
    assert.equal(delays[1], BACKOFF_BASE_MS * 2);
  });

  test("does not retry REVIEW_REQUIRED outcomes", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 2 });

    let callCount = 0;
    const evalFn: EvalFn = async (subId) => {
      callCount++;
      const sub = submissions.find((s) => s.id === subId);
      if (sub) { sub.status = "REVIEW_REQUIRED"; sub.error = "Identity leakage"; }
    };

    await executeBatchMock(batch.id, evalFn, instantDelay);
    assert.equal(callCount, 1);
    assert.equal(batchJobs.find((j) => j.batchRunId === batch.id)!.status, "REVIEW_REQUIRED");
  });
});

describe("job outcome handling", () => {
  test("successful evaluation → COMPLETED", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "EVALUATED"]])), instantDelay);
    assert.equal(batchJobs.find((j) => j.batchRunId === batch.id)!.status, "COMPLETED");
  });

  test("failed evaluation exhausts retries → FAILED", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 1 });
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "FAILED"]])), instantDelay);
    const job = batchJobs.find((j) => j.batchRunId === batch.id)!;
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempt, 2);
    assert.ok(job.error);
  });

  test("review-required evaluation → REVIEW_REQUIRED", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "REVIEW_REQUIRED"]])), instantDelay);
    assert.equal(batchJobs.find((j) => j.batchRunId === batch.id)!.status, "REVIEW_REQUIRED");
  });

  test("thrown error during evaluation → FAILED after retries", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 0 });
    await executeBatchMock(batch.id, async () => { throw new Error("Network timeout"); }, instantDelay);
    const job = batchJobs.find((j) => j.batchRunId === batch.id)!;
    assert.equal(job.status, "FAILED");
    assert.match(job.error!, /Network timeout/);
  });

  test("mixed outcomes across teams", async () => {
    seedTeams(4);
    const outcomes = new Map<string, EvalOutcome>([
      ["team_1", "EVALUATED"], ["team_2", "FAILED"],
      ["team_3", "REVIEW_REQUIRED"], ["team_4", "EVALUATED"],
    ]);
    const { batch } = createBatchMock({ maxRetries: 0 });
    await executeBatchMock(batch.id, makeEvalFn(outcomes), instantDelay);

    const p = getProgressMock(batch.id);
    assert.equal(p.completed, 2);
    assert.equal(p.failed, 1);
    assert.equal(p.reviewRequired, 1);
  });
});

describe("pause", () => {
  test("PAUSE stops new job launches; running jobs finish", async () => {
    seedTeams(6);
    const { batch } = createBatchMock({ concurrency: 1 });

    let jobsStarted = 0;
    const evalFn: EvalFn = async (subId) => {
      jobsStarted++;
      // Pause after the second job starts.
      if (jobsStarted === 2) {
        pauseBatchMock(batch.id);
      }
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    await executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);

    // With concurrency=1, after job 2 triggers the pause, no more should launch.
    assert.equal(jobsStarted, 2, "only 2 jobs should have been launched before pause took effect");
    assert.equal(batch.status, "PAUSED");

    // Remaining 4 jobs should still be QUEUED.
    const remaining = batchJobs.filter((j) => j.batchRunId === batch.id && j.status === "QUEUED");
    assert.equal(remaining.length, 4);

    // Completed jobs should be preserved.
    const completed = batchJobs.filter((j) => j.batchRunId === batch.id && j.status === "COMPLETED");
    assert.equal(completed.length, 2);
  });

  test("cannot pause a non-RUNNING batch", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    // Batch is PENDING, not RUNNING.
    assert.throws(() => pauseBatchMock(batch.id), /Cannot pause/);
  });

  test("cannot pause an already-PAUSED batch", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    batch.status = "RUNNING";
    pauseBatchMock(batch.id);
    assert.throws(() => pauseBatchMock(batch.id), /Cannot pause/);
  });

  test("pause does not corrupt running evaluations", async () => {
    seedTeams(3);
    const { batch } = createBatchMock({ concurrency: 3 });

    let resolvers: (() => void)[] = [];
    const evalFn: EvalFn = async (subId) => {
      // Block until externally resolved.
      await new Promise<void>((resolve) => { resolvers.push(resolve); });
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    // Start the batch — all 3 jobs will be launched immediately.
    const batchPromise = executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);

    // Wait for all 3 to be in-flight.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(resolvers.length, 3, "all 3 jobs should be in flight");

    // Pause now — all 3 are RUNNING.
    batch.status = "PAUSED";

    // Let the running jobs finish.
    for (const r of resolvers) r();
    await batchPromise;

    // All 3 should have completed successfully.
    const completedJobs = batchJobs.filter((j) => j.batchRunId === batch.id && j.status === "COMPLETED");
    assert.equal(completedJobs.length, 3, "all running jobs should complete even after pause");
    assert.equal(batch.status, "PAUSED");
  });
});

describe("resume", () => {
  test("RESUME continues queued jobs after a pause", async () => {
    seedTeams(4);
    const { batch } = createBatchMock({ concurrency: 1 });

    let jobsStarted = 0;
    const evalFn: EvalFn = async (subId) => {
      jobsStarted++;
      if (jobsStarted === 2) pauseBatchMock(batch.id);
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    // Run until pause.
    await executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);
    assert.equal(batch.status, "PAUSED");
    assert.equal(jobsStarted, 2);

    // Resume.
    resumeBatchMock(batch.id);
    assert.equal(batch.status, "RUNNING");

    // Execute the remaining jobs — reset the eval fn to not pause again.
    const simpleEval = makeEvalFn(new Map([
      ["team_3", "EVALUATED"], ["team_4", "EVALUATED"],
    ]));
    await executeBatchMock(batch.id, simpleEval, instantDelay, () => batch.status);

    const p = getProgressMock(batch.id);
    assert.equal(p.completed, 4);
    assert.equal(p.queued, 0);
    assert.equal(batch.status, "COMPLETED");
  });

  test("cannot resume a non-PAUSED batch", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    batch.status = "RUNNING";
    assert.throws(() => resumeBatchMock(batch.id), /Cannot resume/);
  });

  test("cannot resume a COMPLETED batch", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    batch.status = "COMPLETED";
    assert.throws(() => resumeBatchMock(batch.id), /Cannot resume/);
  });
});

describe("cancellation", () => {
  test("cancels QUEUED jobs and marks batch CANCELLED", () => {
    seedTeams(5);
    const { batch } = createBatchMock({});
    cancelBatchMock(batch.id);

    const p = getProgressMock(batch.id);
    assert.equal(p.cancelled, 5);
    assert.equal(p.queued, 0);
    assert.equal(batch.status, "CANCELLED");
  });

  test("cancel preserves already-completed jobs", async () => {
    seedTeams(3);
    const { batch } = createBatchMock({});
    await executeBatchMock(batch.id, makeEvalFn(new Map([
      ["team_1", "EVALUATED"], ["team_2", "EVALUATED"], ["team_3", "EVALUATED"],
    ])), instantDelay);
    cancelBatchMock(batch.id);

    assert.equal(getProgressMock(batch.id).completed, 3);
    assert.equal(getProgressMock(batch.id).cancelled, 0);
  });

  test("cancel from PAUSED state works", () => {
    seedTeams(3);
    const { batch } = createBatchMock({});
    batch.status = "RUNNING";
    pauseBatchMock(batch.id);
    cancelBatchMock(batch.id);
    assert.equal(batch.status, "CANCELLED");
  });

  test("cancel does not affect RUNNING jobs (they finish naturally)", async () => {
    seedTeams(4);
    const { batch } = createBatchMock({ concurrency: 2 });

    let jobsStarted = 0;
    let resolvers: (() => void)[] = [];
    const evalFn: EvalFn = async (subId) => {
      jobsStarted++;
      await new Promise<void>((resolve) => { resolvers.push(resolve); });
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    // Launch — 2 jobs start (concurrency=2).
    const batchPromise = executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(resolvers.length, 2);

    // Cancel while 2 jobs are running, 2 are queued.
    cancelBatchMock(batch.id);

    // Queued jobs should now be CANCELLED.
    const cancelledJobs = batchJobs.filter((j) => j.batchRunId === batch.id && j.status === "CANCELLED");
    assert.equal(cancelledJobs.length, 2);

    // Let running jobs finish.
    for (const r of resolvers) r();
    await batchPromise;

    // Running jobs should have completed.
    const completedJobs = batchJobs.filter((j) => j.batchRunId === batch.id && j.status === "COMPLETED");
    assert.equal(completedJobs.length, 2);
  });
});

describe("retry failed", () => {
  test("re-queues only FAILED jobs", async () => {
    seedTeams(3);
    const outcomes = new Map<string, EvalOutcome>([
      ["team_1", "EVALUATED"], ["team_2", "FAILED"], ["team_3", "REVIEW_REQUIRED"],
    ]);
    const { batch } = createBatchMock({ maxRetries: 0 });
    await executeBatchMock(batch.id, makeEvalFn(outcomes), instantDelay);

    const { requeued } = retryJobsByStatusMock(batch.id, "FAILED");
    assert.equal(requeued, 1);

    const p = getProgressMock(batch.id);
    assert.equal(p.queued, 1);
    assert.equal(p.completed, 1);
    assert.equal(p.reviewRequired, 1);
    assert.equal(batch.status, "RUNNING"); // re-opened
  });

  test("preserves attempt counter from previous run", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 1 });

    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "FAILED"]])), instantDelay);
    const jobBefore = batchJobs.find((j) => j.batchRunId === batch.id)!;
    assert.equal(jobBefore.attempt, 2); // 1 try + 1 retry

    const { previousAttempts } = retryJobsByStatusMock(batch.id, "FAILED");
    assert.deepEqual(previousAttempts, [2]); // recorded the previous attempt count

    const jobAfter = batchJobs.find((j) => j.batchRunId === batch.id)!;
    assert.equal(jobAfter.attempt, 2); // NOT reset
    assert.equal(jobAfter.status, "QUEUED");
    assert.ok(jobAfter.maxRetries > 2, "maxRetries should give headroom for new attempts");
  });

  test("previous submissions preserved after retry", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 0 });

    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "FAILED"]])), instantDelay);
    const subsBefore = submissions.filter((s) => s.teamId === "team_1").length;
    assert.equal(subsBefore, 1);

    retryJobsByStatusMock(batch.id, "FAILED");
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "EVALUATED"]])), instantDelay);

    // Both submissions exist — old one preserved.
    const subsAfter = submissions.filter((s) => s.teamId === "team_1");
    assert.equal(subsAfter.length, 2, "previous submission must be preserved for auditability");
    assert.equal(subsAfter[0].status, "FAILED");
    assert.equal(subsAfter[1].status, "EVALUATED");
  });

  test("retry on empty set returns 0 requeued", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "EVALUATED"]])), instantDelay);

    const { requeued } = retryJobsByStatusMock(batch.id, "FAILED");
    assert.equal(requeued, 0);
  });
});

describe("retry review-required", () => {
  test("re-queues only REVIEW_REQUIRED jobs", async () => {
    seedTeams(3);
    const outcomes = new Map<string, EvalOutcome>([
      ["team_1", "EVALUATED"], ["team_2", "FAILED"], ["team_3", "REVIEW_REQUIRED"],
    ]);
    const { batch } = createBatchMock({ maxRetries: 0 });
    await executeBatchMock(batch.id, makeEvalFn(outcomes), instantDelay);

    const { requeued } = retryJobsByStatusMock(batch.id, "REVIEW_REQUIRED");
    assert.equal(requeued, 1);

    const p = getProgressMock(batch.id);
    assert.equal(p.queued, 1);
    assert.equal(p.failed, 1);
    assert.equal(p.completed, 1);
  });

  test("retry review-required can then succeed", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({ maxRetries: 0 });

    // First run → REVIEW_REQUIRED.
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "REVIEW_REQUIRED"]])), instantDelay);
    assert.equal(batchJobs.find((j) => j.batchRunId === batch.id)!.status, "REVIEW_REQUIRED");

    // Retry → EVALUATED.
    retryJobsByStatusMock(batch.id, "REVIEW_REQUIRED");
    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "EVALUATED"]])), instantDelay);
    assert.equal(batchJobs.find((j) => j.batchRunId === batch.id)!.status, "COMPLETED");
  });
});

describe("idempotency", () => {
  test("re-executing a completed batch is a no-op", async () => {
    seedTeams(2);
    const { batch } = createBatchMock({});
    await executeBatchMock(batch.id, makeEvalFn(new Map([
      ["team_1", "EVALUATED"], ["team_2", "EVALUATED"],
    ])), instantDelay);

    const before = getProgressMock(batch.id);
    await executeBatchMock(batch.id, makeEvalFn(new Map()), instantDelay);
    assert.deepEqual(getProgressMock(batch.id), before);
  });

  test("re-executing a cancelled batch is a no-op", async () => {
    seedTeams(3);
    const { batch } = createBatchMock({});
    cancelBatchMock(batch.id);

    const before = getProgressMock(batch.id);
    await executeBatchMock(batch.id, makeEvalFn(new Map()), instantDelay);
    assert.deepEqual(getProgressMock(batch.id), before);
  });
});

describe("state transition guards", () => {
  test("PENDING → RUNNING on execute", async () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    assert.equal(batch.status, "PENDING");

    await executeBatchMock(batch.id, makeEvalFn(new Map([["team_1", "EVALUATED"]])), instantDelay);
    assert.equal(batch.status, "COMPLETED");
  });

  test("RUNNING → PAUSED → RUNNING → COMPLETED", async () => {
    seedTeams(4);
    const { batch } = createBatchMock({ concurrency: 1 });

    let count = 0;
    const evalFn: EvalFn = async (subId) => {
      count++;
      if (count === 2) pauseBatchMock(batch.id);
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    await executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);
    assert.equal(batch.status, "PAUSED");

    resumeBatchMock(batch.id);
    assert.equal(batch.status, "RUNNING");

    await executeBatchMock(batch.id, makeEvalFn(new Map([
      ["team_3", "EVALUATED"], ["team_4", "EVALUATED"],
    ])), instantDelay, () => batch.status);
    assert.equal(batch.status, "COMPLETED");
  });

  test("RUNNING → CANCELLED is terminal (no resume)", () => {
    seedTeams(1);
    const { batch } = createBatchMock({});
    batch.status = "RUNNING";
    cancelBatchMock(batch.id);
    assert.equal(batch.status, "CANCELLED");
    assert.throws(() => resumeBatchMock(batch.id), /Cannot resume/);
  });

  test("PAUSED → CANCELLED is valid", () => {
    seedTeams(2);
    const { batch } = createBatchMock({});
    batch.status = "RUNNING";
    pauseBatchMock(batch.id);
    cancelBatchMock(batch.id);
    assert.equal(batch.status, "CANCELLED");
  });
});

describe("progress tracking", () => {
  test("reports accurate counts throughout execution", async () => {
    seedTeams(3);
    const { batch } = createBatchMock({});

    const before = getProgressMock(batch.id);
    assert.equal(before.total, 3);
    assert.equal(before.queued, 3);
    assert.equal(before.status, "PENDING");

    await executeBatchMock(batch.id, makeEvalFn(new Map([
      ["team_1", "EVALUATED"], ["team_2", "FAILED"], ["team_3", "EVALUATED"],
    ])), instantDelay);

    const after = getProgressMock(batch.id);
    assert.equal(after.queued, 0);
    assert.equal(after.running, 0);
    assert.equal(after.completed, 2);
    assert.equal(after.failed, 1);
    assert.equal(after.status, "COMPLETED");
  });

  test("batch with no eligible teams throws", () => {
    assert.throws(() => createBatchMock({}), /No eligible teams/);
  });

  test("paused batch shows accurate queued/completed split", async () => {
    seedTeams(5);
    const { batch } = createBatchMock({ concurrency: 1 });

    let count = 0;
    const evalFn: EvalFn = async (subId) => {
      count++;
      if (count === 3) pauseBatchMock(batch.id);
      const sub = submissions.find((s) => s.id === subId);
      if (sub) sub.status = "EVALUATED";
    };

    await executeBatchMock(batch.id, evalFn, instantDelay, () => batch.status);

    const p = getProgressMock(batch.id);
    assert.equal(p.completed, 3);
    assert.equal(p.queued, 2);
    assert.equal(p.status, "PAUSED");
  });
});

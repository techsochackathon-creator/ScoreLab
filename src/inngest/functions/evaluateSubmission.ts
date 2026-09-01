import { put } from "@vercel/blob";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { scoreCriterion } from "@/lib/eval/score";
import type { EvalMetrics, ViewportResult } from "@/lib/eval/types";
import {
  captureResponsiveness,
  cloneRepo,
  connectSandbox,
  createSandbox,
  killSandbox,
  readFileBytes,
  readManifest,
  runCodeQuality,
  runInstall,
  startServer,
} from "@/lib/eval/sandbox";
import { checkUptime, runLighthousePSI } from "@/lib/eval/external";
import type { CheckType, Prisma } from "@prisma/client";

interface LoadedCriterion {
  id: string;
  name: string;
  checkType: CheckType;
  weight: number;
  scoringRules: unknown;
}

const DEFAULT_WIDTHS = [375, 768, 1440];

function deriveWidths(criteria: LoadedCriterion[]): number[] {
  const widths = new Set<number>();
  for (const c of criteria) {
    if (c.checkType !== "responsiveness") continue;
    const vp = (c.scoringRules as { viewports?: unknown })?.viewports;
    if (Array.isArray(vp)) {
      for (const w of vp) if (typeof w === "number") widths.add(w);
    }
  }
  return widths.size ? [...widths].sort((a, b) => a - b) : DEFAULT_WIDTHS;
}

/**
 * Durable evaluation pipeline. Each `step.run` is independently retryable and
 * survives serverless timeouts; the E2B sandbox persists between steps and is
 * reconnected by id. Teardown happens on the success path and in `onFailure`
 * (never in a per-attempt finally, which would kill a sandbox a retry needs).
 */
export const evaluateSubmission = inngest.createFunction(
  {
    id: "evaluate-submission",
    name: "Evaluate hackathon submission",
    retries: 2,
    concurrency: { limit: 5 },
    onFailure: async ({ event }) => {
      // event here is the `inngest/function.failed` envelope.
      const original = (event as unknown as { data: { event?: { data?: { jobId?: string } }; error?: { message?: string } } }).data;
      const jobId = original?.event?.data?.jobId;
      if (!jobId) return;
      const job = await prisma.evaluationJob.findUnique({ where: { id: jobId } });
      if (job?.sandboxId) await killSandbox(job.sandboxId);
      await prisma.evaluationJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: original?.error?.message ?? "evaluation failed",
        },
      });
    },
  },
  { event: "evaluation/requested" },
  async ({ event, step, runId }) => {
    const { submissionId, jobId } = event.data;

    // 1) Load submission + rubric; mark job RUNNING.
    const loaded = await step.run("load-submission", async () => {
      const sub = await prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          team: {
            include: {
              track: { include: { rubrics: { include: { criteria: true } } } },
            },
          },
        },
      });
      if (!sub) throw new NonRetriableError(`submission ${submissionId} not found`);

      await prisma.evaluationJob.update({
        where: { id: jobId },
        data: { status: "RUNNING", startedAt: new Date(), inngestRunId: runId },
      });

      const criteria: LoadedCriterion[] = (
        sub.team.track.rubrics[0]?.criteria ?? []
      ).map((c) => ({
        id: c.id,
        name: c.name,
        checkType: c.checkType,
        weight: c.weight,
        scoringRules: c.scoringRules,
      }));

      return {
        repoUrl: sub.repoUrl,
        liveUrl: sub.liveUrl,
        manifest: sub.manifest,
        criteria,
      };
    });

    const widths = deriveWidths(loaded.criteria);

    // 2) Create sandbox + clone repo. Persist sandboxId for guaranteed teardown.
    const { sandboxId } = await step.run("create-sandbox-clone", async () => {
      const { sandboxId } = await createSandbox({ jobId });
      await prisma.evaluationJob.update({
        where: { id: jobId },
        data: { sandboxId },
      });
      const sbx = await connectSandbox(sandboxId);
      const clone = await cloneRepo(sbx, loaded.repoUrl);
      if (clone.exitCode !== 0) {
        throw new NonRetriableError(
          `git clone failed (exit ${clone.exitCode}): ${clone.stderr.slice(-500)}`,
        );
      }
      return { sandboxId };
    });

    // 3) Resolve manifest (repo file, else stored).
    const manifest = await step.run("read-manifest", async () => {
      const sbx = await connectSandbox(sandboxId);
      return readManifest(sbx, loaded.manifest);
    });

    // 4) Install (5 min command timeout).
    const install = await step.run("install", async () => {
      const sbx = await connectSandbox(sandboxId);
      return runInstall(sbx, manifest.installCommand, manifest.env);
    });

    // 5) Start server + healthcheck (2 min).
    const start = await step.run("start-server", async () => {
      const sbx = await connectSandbox(sandboxId);
      if (install.exitCode !== 0) {
        return { reachable: false, httpCode: null, logsTail: "install failed; server not started" };
      }
      return startServer(sbx, manifest.runCommand, manifest.port, manifest.env);
    });

    // 6) Responsiveness: Playwright inside sandbox, upload screenshots to Blob.
    const responsiveness = await step.run("responsiveness", async () => {
      if (!start.reachable) {
        return {
          viewports: widths.map<ViewportResult>((w) => ({
            width: w,
            status: null,
            overflow: false,
            ok: false,
            blobUrl: null,
          })),
        };
      }
      const sbx = await connectSandbox(sandboxId);
      const results = await captureResponsiveness(sbx, manifest.port, widths);
      const viewports: ViewportResult[] = [];
      for (const r of results) {
        let blobUrl: string | null = null;
        if (r.ok) {
          try {
            const bytes = await readFileBytes(sbx, `/tmp/shot-${r.width}.png`);
            const blob = await put(
              `screenshots/${jobId}/${r.width}.png`,
              Buffer.from(bytes),
              { access: "public", contentType: "image/png" },
            );
            blobUrl = blob.url;
          } catch {
            /* screenshot missing; leave blobUrl null */
          }
        }
        viewports.push({ ...r, blobUrl });
      }
      return { viewports };
    });

    // 7) Uptime + Lighthouse against liveUrl (outside the sandbox).
    const external = await step.run("uptime-lighthouse", async () => {
      if (!loaded.liveUrl) {
        return {
          uptime: { checked: false, httpStatus: null, responseMs: null },
          lighthouse: { performance: null, accessibility: null },
        };
      }
      const [uptime, lighthouse] = await Promise.all([
        checkUptime(loaded.liveUrl),
        runLighthousePSI(loaded.liveUrl),
      ]);
      return { uptime, lighthouse };
    });

    // 8) Code quality inside the sandbox.
    const codeQuality = await step.run("code-quality", async () => {
      const sbx = await connectSandbox(sandboxId);
      return runCodeQuality(sbx);
    });

    // 9) Score every criterion and persist; mark job COMPLETED.
    await step.run("persist-results", async () => {
      const metrics: EvalMetrics = {
        build: {
          installExit: install.exitCode,
          startReachable: start.reachable,
          startHttpCode: start.httpCode,
          logsTail: `${install.logsTail}\n---\n${start.logsTail}`.slice(-4000),
        },
        responsiveness: { viewports: responsiveness.viewports },
        uptime: external.uptime,
        lighthouse: external.lighthouse,
        codeQuality,
      };

      for (const c of loaded.criteria) {
        const s = scoreCriterion(c.checkType, c.scoringRules, metrics);
        const details = s.details as Prisma.InputJsonValue;
        await prisma.criterionResult.upsert({
          where: { jobId_criterionId: { jobId, criterionId: c.id } },
          create: {
            jobId,
            criterionId: c.id,
            rawMetric: s.rawMetric,
            computedScore: s.computedScore,
            details,
          },
          update: {
            rawMetric: s.rawMetric,
            computedScore: s.computedScore,
            details,
          },
        });
      }

      await prisma.evaluationJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    });

    // 10) Teardown on the success path.
    await step.run("teardown-sandbox", async () => {
      await killSandbox(sandboxId);
    });

    return { jobId, status: "completed", manifestSource: manifest.source };
  },
);

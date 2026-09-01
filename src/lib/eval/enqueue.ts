import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

/**
 * Create a QUEUED EvaluationJob for a submission and emit the Inngest event
 * that starts the durable pipeline. Returns the new job id.
 */
export async function enqueueEvaluation(
  submissionId: string,
  trigger: "submit" | "manual",
): Promise<string> {
  const job = await prisma.evaluationJob.create({
    data: { submissionId, status: "QUEUED" },
  });

  await inngest.send({
    name: "evaluation/requested",
    data: { jobId: job.id, submissionId, trigger },
  });

  return job.id;
}

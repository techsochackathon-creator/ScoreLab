import { prisma } from "@/lib/prisma";
import { fetchRepoEvidence, type RepoEvidence } from "@/lib/github";
import { evaluateWithGemini, PROMPT_VERSION, MODEL_CONFIG, EVAL_MODEL } from "@/lib/gemini";
import { calculateFinalScore } from "@/lib/scoring";
import { getOrCreateRubric } from "@/lib/rubric";
import { anonymizeEvidence, buildIdentityContext } from "@/lib/anonymize";
import { containsIdentityLeakage } from "@/lib/identityGate";
import { assessEvidence } from "@/lib/evidenceQuality";
import { validateAiOutput, validateRubricWeights } from "@/lib/validateAiOutput";
import { buildRunRecord, rubricVersionHash, type CriterionScoreSnapshot } from "@/lib/evaluationVersion";
import type { Prisma, SubmissionStatus } from "@prisma/client";

/**
 * Run (or re-run) the AI evaluation for a submission, synchronously:
 *   GitHub evidence (raw) → anonymize → identity gate → completeness → Gemini
 *   → strict validation → deterministic score.
 *
 * VERSIONING: every terminal outcome (evaluated / review-required / failed)
 * appends a NEW immutable EvaluationEvent record capturing exactly what produced
 * the result. Re-runs never overwrite prior records. The Submission +
 * CriterionScore rows are a "latest run" mirror for the current UI.
 */
export async function runEvaluation(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { team: true },
  });
  if (!submission) return;

  const startedAt = new Date();

  // Progressive context captured for the immutable version record.
  let rubricVersion = "unknown";
  let modelName: string | null = null;
  let rawEvidence: RepoEvidence | null = null;
  let sanitized: unknown = null;
  let evidenceFetchedAt: Date | null = null;
  let commitSha: string | null = null;
  let evConfidence: number | null = null;
  let criterionSnapshot: CriterionScoreSnapshot[] | null = null;

  async function recordRun(
    status: string,
    opts: { finalScore?: number | null; flags?: string[]; error?: string | null } = {},
  ) {
    const record = buildRunRecord({
      submissionId,
      teamId: submission!.teamId,
      repoUrl: submission!.repoUrl,
      commitSha,
      evidenceFetchedAt,
      rubricVersion,
      promptVersion: PROMPT_VERSION,
      model: modelName,
      modelConfig: { ...MODEL_CONFIG, model: modelName ?? EVAL_MODEL },
      status,
      finalScore: opts.finalScore ?? null,
      confidence: evConfidence,
      flags: opts.flags ?? [],
      error: opts.error ?? null,
      criterionScores: criterionSnapshot,
      rawEvidence,
      sanitizedEvidence: sanitized,
      startedAt,
      completedAt: new Date(),
    });
    const json = (v: unknown) => (v == null ? undefined : (v as Prisma.InputJsonValue));
    await prisma.evaluationEvent.create({
      data: {
        teamId: record.teamId,
        submissionId: record.submissionId,
        repoUrl: record.repoUrl,
        commitSha: record.commitSha,
        evidenceFetchedAt: record.evidenceFetchedAt,
        rubricVersion: record.rubricVersion,
        promptVersion: record.promptVersion,
        model: record.model,
        modelConfig: json(record.modelConfig),
        status: record.status as SubmissionStatus,
        totalScore: record.totalScore,
        finalScore: record.finalScore,
        confidence: record.confidence,
        flags: record.flags,
        error: record.error,
        criterionScores: json(record.criterionScores),
        rawEvidence: json(record.rawEvidence),
        sanitizedEvidence: json(record.sanitizedEvidence),
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      },
    });
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "EVALUATING", error: null },
  });

  try {
    const rubric = await getOrCreateRubric();
    if (rubric.criteria.length === 0) {
      throw new Error("Rubric has no criteria — configure the rubric first.");
    }
    rubricVersion = rubricVersionHash({
      name: rubric.name,
      criteria: rubric.criteria.map((c) => ({
        name: c.name,
        description: c.description,
        weight: c.weight,
        scaleMax: c.scaleMax,
        anchors: c.anchors,
      })),
    });

    // (Req #9) Rubric weights must total 100%.
    const weightCheck = validateRubricWeights(rubric.criteria);
    if (!weightCheck.valid) {
      const error = `Rubric weights total ${weightCheck.sum}%, but must total 100%. Fix the rubric before evaluating.`;
      await mirror(submissionId, { status: "REVIEW_REQUIRED", flags: ["INVALID_RUBRIC"], error });
      await recordRun("REVIEW_REQUIRED", { flags: ["INVALID_RUBRIC"], error });
      return;
    }

    // Raw evidence snapshot — preserved for audit, never sent to the model.
    rawEvidence = await fetchRepoEvidence(submission.repoUrl);
    evidenceFetchedAt = new Date();
    commitSha = rawEvidence.headSha;

    // Sanitized copy: identities redacted, technical detail preserved.
    const identity = buildIdentityContext(submission.team, rawEvidence.owner);
    const anon = anonymizeEvidence(rawEvidence, identity);
    sanitized = anon.sanitized;
    const anonymization = anon.report;

    // Security gate: identity leakage → withhold from the model.
    const leakage = containsIdentityLeakage(anon.sanitized, identity);
    if (leakage.leaked) {
      const error = `Identity leakage detected after anonymization: ${leakage.reasons.join(", ")}. Evaluation withheld from the model pending manual review.`;
      await mirror(submissionId, {
        status: "REVIEW_REQUIRED",
        flags: ["IDENTITY_LEAKAGE"],
        error,
        evidence: summarize(rawEvidence, { anonymization, raw: rawEvidence, sanitized: anon.sanitized }),
      });
      await recordRun("REVIEW_REQUIRED", { flags: ["IDENTITY_LEAKAGE"], error });
      return;
    }

    // Evidence completeness check.
    const completeness = assessEvidence(
      rawEvidence,
      rubric.criteria.map((c) => ({ id: c.id, name: c.name })),
    );
    evConfidence = completeness.confidence;
    if (completeness.status === "INSUFFICIENT") {
      const error = `Insufficient evidence to score the rubric. Missing: ${completeness.missing.join(", ") || "core project evidence"}. Evaluation withheld from the model pending manual review.`;
      await mirror(submissionId, {
        status: "REVIEW_REQUIRED",
        flags: ["INSUFFICIENT_EVIDENCE"],
        confidence: completeness.confidence,
        error,
        evidence: summarize(rawEvidence, { anonymization, completeness, raw: rawEvidence, sanitized: anon.sanitized }),
      });
      await recordRun("REVIEW_REQUIRED", { flags: ["INSUFFICIENT_EVIDENCE"], error });
      return;
    }

    const { rawText, model } = await evaluateWithGemini(
      rubric.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        weight: c.weight,
        scaleMax: c.scaleMax,
        anchors: c.anchors,
      })),
      anon.sanitized,
    );
    modelName = model;

    // Strict validation of the model's structured output.
    const validation = validateAiOutput(rawText, {
      criteria: rubric.criteria.map((c) => ({ id: c.id, name: c.name, scaleMax: c.scaleMax })),
      knownFiles: [...rawEvidence.fileTree, ...rawEvidence.keyFiles.map((f) => f.path)],
      hasReadme: !!rawEvidence.readme,
    });
    if (!validation.valid) {
      const error = `Model output failed validation: ${validation.issues.map((i) => i.code).join(", ")}. Not finalized; raw response preserved for review.`;
      await mirror(submissionId, {
        status: "REVIEW_REQUIRED",
        flags: ["INVALID_AI_OUTPUT"],
        confidence: completeness.confidence,
        error,
        evidence: summarize(rawEvidence, {
          anonymization,
          completeness,
          raw: rawEvidence,
          sanitized: anon.sanitized,
          aiRawResponse: rawText,
          aiValidationIssues: validation.issues,
        }),
      });
      await recordRun("REVIEW_REQUIRED", { flags: ["INVALID_AI_OUTPUT"], error });
      return;
    }

    const validated = validation.scores!;

    // Deterministic backend-owned weighted calculation.
    const calc = calculateFinalScore(
      rubric.criteria.map((c) => ({ id: c.id, weight: c.weight, scaleMax: c.scaleMax })),
      validated.map((s) => ({ criterionId: s.criterionId, score: s.score })),
    );
    if (!calc.ok || calc.finalScore == null) {
      const error = `Score calculation failed: ${calc.errors.join(" ")}`;
      await mirror(submissionId, { status: "REVIEW_REQUIRED", flags: ["SCORE_CALCULATION_ERROR"], error });
      await recordRun("REVIEW_REQUIRED", { flags: ["SCORE_CALCULATION_ERROR"], error });
      return;
    }
    const total = calc.finalScore;

    // Immutable per-criterion snapshot for the version record.
    const critById = new Map(rubric.criteria.map((c) => [c.id, c]));
    const weightedById = new Map(calc.breakdown.map((b) => [b.criterionId, b.weighted]));
    criterionSnapshot = validated.map((s) => {
      const c = critById.get(s.criterionId)!;
      return {
        criterionId: s.criterionId,
        name: c.name,
        score: s.score,
        weight: c.weight,
        scaleMax: c.scaleMax,
        weighted: weightedById.get(s.criterionId) ?? 0,
        confidence: s.confidence,
        reasoning: s.reasoning,
        evidenceRefs: s.evidenceRefs,
      };
    });

    const flags = completeness.status === "LIMITED" ? ["LIMITED_EVIDENCE"] : [];
    const cleaned = validated.map((s) => ({
      criterionId: s.criterionId,
      score: s.score,
      reasoning: s.reasoning.slice(0, 4000),
    }));

    await prisma.$transaction([
      prisma.criterionScore.deleteMany({ where: { submissionId } }),
      prisma.criterionScore.createMany({ data: cleaned.map((s) => ({ submissionId, ...s })) }),
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: "EVALUATED",
          totalScore: total,
          finalScore: total,
          model,
          evidence: summarize(rawEvidence, {
            anonymization,
            completeness,
            aiOutput: validated,
            scoreBreakdown: calc.breakdown,
            rubricVersion,
            promptVersion: PROMPT_VERSION,
            raw: rawEvidence,
            sanitized: anon.sanitized,
          }) as unknown as Prisma.InputJsonValue,
          evaluatedAt: new Date(),
          error: null,
          confidence: completeness.confidence,
          flags,
        },
      }),
    ]);

    // Append the immutable version record (never overwrites prior runs).
    await recordRun("EVALUATED", { finalScore: total, flags });
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    await mirror(submissionId, { status: "FAILED", error });
    await recordRun("FAILED", { error });
  }
}

// --- helpers ---------------------------------------------------------------

function summarize(raw: RepoEvidence, extra: Record<string, unknown>) {
  return {
    repo: `${raw.owner}/${raw.repo}`,
    fileCount: raw.fileCount,
    commitCount: raw.commitCount,
    contributorCount: raw.contributorCount,
    keyFiles: raw.keyFiles.map((f) => f.path),
    hasReadme: !!raw.readme,
    ...extra,
  };
}

async function mirror(
  submissionId: string,
  data: {
    status: SubmissionStatus;
    flags?: string[];
    confidence?: number | null;
    error?: string | null;
    evidence?: Record<string, unknown>;
  },
) {
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      status: data.status,
      flags: data.flags ?? [],
      confidence: data.confidence,
      error: data.error ?? null,
      evaluatedAt: new Date(),
      ...(data.evidence ? { evidence: data.evidence as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

import { prisma } from "@/lib/prisma";
import type { EvalRun, Prisma } from "@prisma/client";
import {
  detectTies,
  resolveByHierarchy,
  resolveBySecondaryEval,
  resolveByOrganizer,
  applyTieBreaks,
  buildTiedTeam,
  defaultPriorityOrder,
  type TieResolution,
  type TieGroup,
  type TiedTeam,
} from "@/lib/tieBreaker";
import { runSecondaryTieEvaluation, SECONDARY_EVAL_VERSION } from "@/lib/secondaryTieEval";

/**
 * Evaluation run lifecycle engine.
 *
 * States: DRAFT → EVALUATING → FINALIZED → PUBLISHED
 *
 * DRAFT: evaluations can be created/re-run; batch processing can start.
 * EVALUATING: batch processing is active (set automatically by batch engine).
 * FINALIZED: results locked — scores/ranking frozen; further evaluations
 *            require a new run. Organizer must explicitly finalize.
 * PUBLISHED: the public leaderboard displays this run's snapshot.
 *
 * The snapshot is an immutable JSON array of team rankings captured at
 * finalization time. Once finalized, the ranking cannot change.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotTeam {
  rank: number;
  teamId: string;
  teamName: string;
  university: string;
  track: string;
  totalScore: number;
  confidence: number | null;
  flags: string[];
  model: string | null;
  promptVersion: string | null;
  rubricVersion: string | null;
  evaluatedAt: string | null;
  /** Tie-break metadata (present only when the team was in a tie group). */
  tieBreakRank?: number;
  tieBreakMethod?: string;
  tieBreakResolvedBy?: string | null;
}

export interface ReadinessCheck {
  ready: boolean;
  totalTeams: number;
  evaluated: number;
  unevaluated: number;
  failed: number;
  reviewRequired: number;
  evaluating: number;
  incompleteEvidence: number;
  activeBatches: number;
  issues: string[];
}

export interface EvalRunDetail {
  id: string;
  name: string;
  status: string;
  totalTeams: number;
  forcedFinalization: boolean;
  finalizationNote: string | null;
  rubricVersion: string | null;
  promptVersion: string | null;
  modelVersion: string | null;
  finalizedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  snapshot: SnapshotTeam[] | null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createEvalRun(opts: {
  name?: string;
  createdBy?: string;
}): Promise<EvalRun> {
  return prisma.evalRun.create({
    data: {
      name: opts.name || `Run ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      createdBy: opts.createdBy ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listEvalRuns(): Promise<EvalRunDetail[]> {
  const runs = await prisma.evalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return runs.map(toDetail);
}

export async function getEvalRun(id: string): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id } });
  if (!run) throw new Error("Evaluation run not found");
  return toDetail(run);
}

function toDetail(run: EvalRun): EvalRunDetail {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    totalTeams: run.totalTeams,
    forcedFinalization: run.forcedFinalization,
    finalizationNote: run.finalizationNote,
    rubricVersion: run.rubricVersion,
    promptVersion: run.promptVersion,
    modelVersion: run.modelVersion,
    finalizedAt: run.finalizedAt?.toISOString() ?? null,
    publishedAt: run.publishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    snapshot: run.snapshot as SnapshotTeam[] | null,
  };
}

// ---------------------------------------------------------------------------
// Readiness check (pre-finalization)
// ---------------------------------------------------------------------------

export async function checkReadiness(): Promise<ReadinessCheck> {
  const issues: string[] = [];

  // All teams with repos.
  const totalTeams = await prisma.team.count({ where: { repoUrl: { not: null } } });

  // Latest evaluated submission per team.
  const evaluatedSubs = await prisma.submission.findMany({
    where: { status: "EVALUATED", finalScore: { not: null } },
    orderBy: { evaluatedAt: "desc" },
    select: { teamId: true },
    distinct: ["teamId"],
  });
  const evaluatedTeamIds = new Set(evaluatedSubs.map((s) => s.teamId));
  const evaluated = evaluatedTeamIds.size;
  const unevaluated = totalTeams - evaluated;

  // Failed submissions (latest per team).
  const failedSubs = await prisma.submission.findMany({
    where: { status: "FAILED" },
    select: { teamId: true },
    distinct: ["teamId"],
  });
  const failed = failedSubs.filter((s) => !evaluatedTeamIds.has(s.teamId)).length;

  // Review required (latest per team, excluding already evaluated).
  const reviewSubs = await prisma.submission.findMany({
    where: { status: "REVIEW_REQUIRED" },
    select: { teamId: true },
    distinct: ["teamId"],
  });
  const reviewRequired = reviewSubs.filter((s) => !evaluatedTeamIds.has(s.teamId)).length;

  // Currently evaluating.
  const evaluatingSubs = await prisma.submission.count({
    where: { status: "EVALUATING" },
  });

  // Incomplete evidence (teams with LOW confidence — below 0.3).
  const lowConfidence = await prisma.submission.findMany({
    where: { status: "EVALUATED", confidence: { lt: 0.3 } },
    select: { teamId: true },
    distinct: ["teamId"],
  });
  const incompleteEvidence = lowConfidence.length;

  // Active batches.
  const activeBatches = await prisma.batchRun.count({
    where: { status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
  });

  // Build issue list.
  if (unevaluated > 0) issues.push(`${unevaluated} team(s) have not been evaluated`);
  if (failed > 0) issues.push(`${failed} team(s) have failed evaluations`);
  if (reviewRequired > 0) issues.push(`${reviewRequired} team(s) require review`);
  if (evaluatingSubs > 0) issues.push(`${evaluatingSubs} evaluation(s) still in progress`);
  if (activeBatches > 0) issues.push(`${activeBatches} batch(es) still active`);
  if (incompleteEvidence > 0) issues.push(`${incompleteEvidence} team(s) have low evidence confidence`);

  return {
    ready: issues.length === 0,
    totalTeams,
    evaluated,
    unevaluated,
    failed,
    reviewRequired,
    evaluating: evaluatingSubs,
    incompleteEvidence,
    activeBatches,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

/**
 * Finalize an evaluation run: lock scores and capture an immutable snapshot.
 *
 * If `force` is true, finalization proceeds even if readiness checks fail.
 * The `note` field records why the organizer chose to force finalization.
 */
export async function finalizeRun(
  runId: string,
  opts: { force?: boolean; note?: string } = {},
): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "DRAFT" && run.status !== "EVALUATING") {
    throw new Error(`Cannot finalize a run in status ${run.status}. Only DRAFT or EVALUATING runs can be finalized.`);
  }

  // Readiness gate.
  const readiness = await checkReadiness();
  if (!readiness.ready && !opts.force) {
    throw new Error(
      `Cannot finalize: ${readiness.issues.join("; ")}. Use force finalization to proceed anyway.`,
    );
  }

  // Build the immutable snapshot from the latest EVALUATED submission per team.
  const subs = await prisma.submission.findMany({
    where: { status: "EVALUATED", finalScore: { not: null } },
    orderBy: { evaluatedAt: "desc" },
    include: {
      team: { select: { id: true, name: true, university: true, track: true } },
    },
  });

  const seen = new Set<string>();
  const snapshot: SnapshotTeam[] = [];
  for (const s of subs) {
    if (seen.has(s.teamId)) continue;
    seen.add(s.teamId);

    // Get the matching EvaluationEvent for version info.
    const event = await prisma.evaluationEvent.findFirst({
      where: { submissionId: s.id, status: "EVALUATED" },
      orderBy: { createdAt: "desc" },
      select: { model: true, promptVersion: true, rubricVersion: true },
    });

    snapshot.push({
      rank: 0, // Set after sorting.
      teamId: s.teamId,
      teamName: s.team.name,
      university: s.team.university,
      track: s.team.track,
      totalScore: s.finalScore!,
      confidence: s.confidence,
      flags: s.flags,
      model: event?.model ?? s.model ?? null,
      promptVersion: event?.promptVersion ?? null,
      rubricVersion: event?.rubricVersion ?? null,
      evaluatedAt: s.evaluatedAt?.toISOString() ?? null,
    });
  }

  // Sort by score descending.
  snapshot.sort((a, b) => b.totalScore - a.totalScore);

  // -----------------------------------------------------------------------
  // Tie detection & resolution
  // -----------------------------------------------------------------------
  const ties = detectTies(snapshot.map((t) => ({ teamId: t.teamId, totalScore: t.totalScore })));
  const resolutions = new Map<number, TieResolution>();
  const auditRecords: {
    tiedTeamIds: string[];
    tiedScore: number;
    method: string;
    resolvedBy: string | null;
    reasoning: string;
    secondaryResults: unknown;
    resolvedOrder: string[];
  }[] = [];

  if (ties.length > 0) {
    // Load tie-break config (or use default criterion order).
    const tieConfig = await prisma.tieBreakConfig.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const rubric = await prisma.rubric.findFirst({
      include: { criteria: { orderBy: { order: "asc" } } },
    });
    const criteria = rubric?.criteria ?? [];

    const priorityOrder: string[] = tieConfig
      ? (tieConfig.priorityOrder as string[])
      : defaultPriorityOrder(criteria.map((c) => ({ id: c.id, order: c.order })));

    // Build criterion scores for tied teams.
    for (const tieGroup of ties) {
      const tiedTeams: TiedTeam[] = [];

      for (const teamId of tieGroup.teamIds) {
        const sub = await prisma.submission.findFirst({
          where: { teamId, status: "EVALUATED", finalScore: { not: null } },
          orderBy: { evaluatedAt: "desc" },
          include: { scores: true },
        });
        if (!sub) continue;

        const snapTeam = snapshot.find((s) => s.teamId === teamId);
        tiedTeams.push(
          buildTiedTeam(
            teamId,
            snapTeam?.teamName ?? teamId,
            sub.finalScore!,
            sub.scores.map((s) => ({ criterionId: s.criterionId, score: s.score })),
          ),
        );
      }

      if (tiedTeams.length < 2) continue;

      // Step 1: Criterion hierarchy.
      const resolution = resolveByHierarchy(tiedTeams, priorityOrder);

      if (!resolution.needsFurtherResolution) {
        resolutions.set(tieGroup.score, resolution);
        auditRecords.push({
          tiedTeamIds: tieGroup.teamIds,
          tiedScore: tieGroup.score,
          method: resolution.method,
          resolvedBy: resolution.resolvedBy,
          reasoning: resolution.reasoning,
          secondaryResults: null,
          resolvedOrder: resolution.resolvedOrder,
        });
      } else {
        // Step 2: Try secondary AI evaluation (only if not forced-offline).
        let secondaryResolution: TieResolution | null = null;
        let secondaryResults: unknown = null;

        try {
          // Get anonymized evidence for tied teams.
          const teamEvidence = await Promise.all(
            tiedTeams.filter((t) =>
              resolution.resolvedOrder.slice(-tiedTeams.length).includes(t.teamId),
            ).map(async (t) => {
              const sub = await prisma.submission.findFirst({
                where: { teamId: t.teamId, status: "EVALUATED" },
                orderBy: { evaluatedAt: "desc" },
                select: { evidence: true },
              });
              const ev = sub?.evidence as Record<string, unknown> | null;
              return {
                teamId: t.teamId,
                teamName: t.teamName,
                evidence: {
                  readme: (ev?.sanitized as Record<string, unknown>)?.readme as string | null ?? null,
                  fileTree: ((ev?.sanitized as Record<string, unknown>)?.fileTree as string[]) ?? [],
                  keyFiles: ((ev?.sanitized as Record<string, unknown>)?.keyFiles as { path: string; content: string }[]) ?? [],
                  description: (ev?.sanitized as Record<string, unknown>)?.description as string | null ?? null,
                },
              };
            }),
          );

          const secResults = await runSecondaryTieEvaluation(teamEvidence);
          secondaryResults = secResults;
          secondaryResolution = resolveBySecondaryEval(secResults);
        } catch (e) {
          // Secondary evaluation failed — record the failure, leave as unresolved.
          const errorMsg = (e as Error).message.slice(0, 500);
          secondaryResolution = {
            resolvedOrder: tiedTeams.map((t) => t.teamId),
            method: "UNRESOLVED",
            resolvedBy: null,
            reasoning: `${resolution.reasoning} Secondary evaluation failed: ${errorMsg}. TIE_REQUIRES_ORGANIZER_DECISION.`,
            needsFurtherResolution: true,
          };
        }

        if (secondaryResolution && !secondaryResolution.needsFurtherResolution) {
          resolutions.set(tieGroup.score, secondaryResolution);
        } else {
          // Mark as unresolved — organizer must decide.
          resolutions.set(tieGroup.score, secondaryResolution ?? {
            resolvedOrder: tiedTeams.map((t) => t.teamId),
            method: "UNRESOLVED",
            resolvedBy: null,
            reasoning: `${resolution.reasoning} TIE_REQUIRES_ORGANIZER_DECISION.`,
            needsFurtherResolution: true,
          });
        }

        auditRecords.push({
          tiedTeamIds: tieGroup.teamIds,
          tiedScore: tieGroup.score,
          method: (secondaryResolution ?? resolutions.get(tieGroup.score)!).method,
          resolvedBy: (secondaryResolution ?? resolutions.get(tieGroup.score)!).resolvedBy,
          reasoning: (secondaryResolution ?? resolutions.get(tieGroup.score)!).reasoning,
          secondaryResults,
          resolvedOrder: (secondaryResolution ?? resolutions.get(tieGroup.score)!).resolvedOrder,
        });
      }
    }
  }

  // Apply tie-break results and assign unique ranks.
  const ranked = applyTieBreaks(
    snapshot.map((t) => ({ teamId: t.teamId, teamName: t.teamName, totalScore: t.totalScore })),
    resolutions,
  );

  // Merge rank and tie-break metadata into snapshot.
  const rankMap = new Map(ranked.map((r) => [r.teamId, r]));
  for (const t of snapshot) {
    const r = rankMap.get(t.teamId);
    if (r) {
      t.rank = r.rank;
      if (r.tieBreakRank !== undefined) t.tieBreakRank = r.tieBreakRank;
      if (r.tieBreakMethod !== undefined) t.tieBreakMethod = r.tieBreakMethod;
      if (r.tieBreakResolvedBy !== undefined) t.tieBreakResolvedBy = r.tieBreakResolvedBy;
    }
  }
  // Re-sort by rank.
  snapshot.sort((a, b) => a.rank - b.rank);

  // Extract dominant versions from the snapshot.
  const models = snapshot.map((t) => t.model).filter(Boolean);
  const promptVersions = snapshot.map((t) => t.promptVersion).filter(Boolean);
  const rubricVersions = snapshot.map((t) => t.rubricVersion).filter(Boolean);
  const mode = (arr: string[]) => arr.length === 0 ? null : [...arr.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0][0];

  const updated = await prisma.evalRun.update({
    where: { id: runId },
    data: {
      status: "FINALIZED",
      snapshot: snapshot as unknown as object[],
      totalTeams: snapshot.length,
      rubricVersion: mode(rubricVersions as string[]),
      promptVersion: mode(promptVersions as string[]),
      modelVersion: mode(models as string[]),
      forcedFinalization: !readiness.ready && !!opts.force,
      finalizationNote: opts.note ?? null,
      finalizedAt: new Date(),
    },
  });

  // Write tie-break audit records.
  for (const audit of auditRecords) {
    await prisma.tieBreakAudit.create({
      data: {
        evalRunId: runId,
        tiedTeamIds: audit.tiedTeamIds,
        tiedScore: audit.tiedScore,
        method: audit.method as "CRITERION_HIERARCHY" | "SECONDARY_EVALUATION" | "ORGANIZER_DECISION" | "UNRESOLVED",
        resolvedBy: audit.resolvedBy,
        reasoning: audit.reasoning,
        secondaryResults: audit.secondaryResults as Prisma.InputJsonValue ?? undefined,
        resolvedOrder: audit.resolvedOrder as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Publish a finalized run: makes the leaderboard visible to the public.
 * Only one run can be PUBLISHED at a time — the previous published run
 * is reverted to FINALIZED.
 */
export async function publishRun(runId: string): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "FINALIZED") {
    throw new Error(`Cannot publish a run in status ${run.status}. Only FINALIZED runs can be published.`);
  }

  // Demote any currently-published run.
  await prisma.evalRun.updateMany({
    where: { status: "PUBLISHED" },
    data: { status: "FINALIZED" },
  });

  const updated = await prisma.evalRun.update({
    where: { id: runId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Unpublish (revert to FINALIZED)
// ---------------------------------------------------------------------------

export async function unpublishRun(runId: string): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "PUBLISHED") {
    throw new Error(`Cannot unpublish a run in status ${run.status}.`);
  }

  const updated = await prisma.evalRun.update({
    where: { id: runId },
    data: { status: "FINALIZED" },
  });

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Delete a DRAFT run
// ---------------------------------------------------------------------------

export async function deleteEvalRun(runId: string): Promise<void> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "DRAFT") {
    throw new Error(`Cannot delete a run in status ${run.status}. Only DRAFT runs can be deleted.`);
  }

  await prisma.evalRun.delete({ where: { id: runId } });
}

// ---------------------------------------------------------------------------
// Get published snapshot for the public leaderboard
// ---------------------------------------------------------------------------

export async function getPublishedSnapshot(): Promise<{
  run: EvalRunDetail;
  snapshot: SnapshotTeam[];
} | null> {
  const run = await prisma.evalRun.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });
  if (!run || !run.snapshot) return null;

  return {
    run: toDetail(run),
    snapshot: run.snapshot as unknown as SnapshotTeam[],
  };
}

// ---------------------------------------------------------------------------
// Transition to EVALUATING (called by batch engine when starting)
// ---------------------------------------------------------------------------

export async function markEvaluating(runId: string): Promise<void> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (run.status === "DRAFT") {
    await prisma.evalRun.update({
      where: { id: runId },
      data: { status: "EVALUATING" },
    });
  }
}

// ---------------------------------------------------------------------------
// Back to DRAFT (e.g., after batch completes and user wants more changes)
// ---------------------------------------------------------------------------

export async function revertToDraft(runId: string): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "EVALUATING") {
    throw new Error(`Cannot revert to DRAFT from status ${run.status}.`);
  }

  const updated = await prisma.evalRun.update({
    where: { id: runId },
    data: { status: "DRAFT" },
  });

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Tie-break: organizer manual resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an unresolved tie via organizer decision.
 *
 * Only works on FINALIZED runs with UNRESOLVED tie-break audits.
 * Updates the snapshot ranking and writes a new audit record.
 */
export async function resolveOrganizerTie(
  runId: string,
  opts: {
    tiedTeamIds: string[];
    resolvedOrder: string[];
    note: string;
    decidedBy?: string;
  },
): Promise<EvalRunDetail> {
  const run = await prisma.evalRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Evaluation run not found");

  if (run.status !== "FINALIZED") {
    throw new Error(`Cannot resolve ties on a run in status ${run.status}. Only FINALIZED runs allow tie resolution.`);
  }

  // Validate the resolution.
  const resolution = resolveByOrganizer(opts.tiedTeamIds, opts.resolvedOrder, opts.note);

  // Get current snapshot.
  const snapshot = run.snapshot as unknown as SnapshotTeam[];
  if (!snapshot) throw new Error("Run has no snapshot");

  // Find the tied score.
  const tiedTeamSet = new Set(opts.tiedTeamIds);
  const tiedScores = snapshot.filter((t) => tiedTeamSet.has(t.teamId)).map((t) => t.totalScore);
  const uniqueScores = [...new Set(tiedScores)];
  if (uniqueScores.length !== 1) {
    throw new Error("The specified teams do not share the same score — they are not tied.");
  }
  const tiedScore = uniqueScores[0];

  // Build new resolutions map with just this resolution.
  const resolutions = new Map<number, TieResolution>();
  resolutions.set(tiedScore, resolution);

  // Re-apply tie-break to just the affected group within the snapshot.
  const ranked = applyTieBreaks(
    snapshot.map((t) => ({ teamId: t.teamId, teamName: t.teamName, totalScore: t.totalScore })),
    resolutions,
  );

  // Merge updated ranks into snapshot.
  const rankMap = new Map(ranked.map((r) => [r.teamId, r]));
  for (const t of snapshot) {
    const r = rankMap.get(t.teamId);
    if (r) {
      t.rank = r.rank;
      if (tiedTeamSet.has(t.teamId)) {
        t.tieBreakRank = r.tieBreakRank;
        t.tieBreakMethod = "ORGANIZER_DECISION";
        t.tieBreakResolvedBy = null;
      }
    }
  }
  snapshot.sort((a, b) => a.rank - b.rank);

  // Update the run snapshot.
  const updated = await prisma.evalRun.update({
    where: { id: runId },
    data: {
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  // Write audit record.
  await prisma.tieBreakAudit.create({
    data: {
      evalRunId: runId,
      tiedTeamIds: opts.tiedTeamIds,
      tiedScore,
      method: "ORGANIZER_DECISION",
      resolvedBy: null,
      reasoning: resolution.reasoning,
      organizerNote: opts.note,
      decidedBy: opts.decidedBy ?? null,
      resolvedOrder: opts.resolvedOrder as unknown as Prisma.InputJsonValue,
    },
  });

  return toDetail(updated);
}

// ---------------------------------------------------------------------------
// Tie-break: query audit trail
// ---------------------------------------------------------------------------

export interface TieBreakAuditDetail {
  id: string;
  evalRunId: string;
  tiedTeamIds: string[];
  tiedScore: number;
  method: string;
  resolvedBy: string | null;
  reasoning: string;
  secondaryResults: unknown;
  organizerNote: string | null;
  decidedBy: string | null;
  resolvedOrder: string[];
  createdAt: string;
}

export async function getTieBreakAudits(evalRunId: string): Promise<TieBreakAuditDetail[]> {
  const audits = await prisma.tieBreakAudit.findMany({
    where: { evalRunId },
    orderBy: { createdAt: "desc" },
  });
  return audits.map((a) => ({
    id: a.id,
    evalRunId: a.evalRunId,
    tiedTeamIds: a.tiedTeamIds,
    tiedScore: a.tiedScore,
    method: a.method,
    resolvedBy: a.resolvedBy,
    reasoning: a.reasoning,
    secondaryResults: a.secondaryResults,
    organizerNote: a.organizerNote,
    decidedBy: a.decidedBy,
    resolvedOrder: a.resolvedOrder as string[],
    createdAt: a.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Tie-break: configuration
// ---------------------------------------------------------------------------

export async function saveTieBreakConfig(
  priorityOrder: string[],
  opts: { name?: string; createdBy?: string } = {},
) {
  return prisma.tieBreakConfig.create({
    data: {
      priorityOrder: priorityOrder as unknown as Prisma.InputJsonValue,
      name: opts.name ?? "Default tie-break priority",
      createdBy: opts.createdBy ?? null,
    },
  });
}

export async function getActiveTieBreakConfig() {
  return prisma.tieBreakConfig.findFirst({
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Tie-break: check for unresolved ties in a run
// ---------------------------------------------------------------------------

export async function getUnresolvedTies(evalRunId: string): Promise<TieBreakAuditDetail[]> {
  const audits = await getTieBreakAudits(evalRunId);
  return audits.filter((a) => a.method === "UNRESOLVED" || a.method === "SECONDARY_EVALUATION");
}

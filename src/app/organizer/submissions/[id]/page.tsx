import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/misc";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { ProgressBar, bandVar, totalBandVar } from "@/components/ui/ProgressBar";
import { ReEvaluateButton } from "@/components/ReEvaluateButton";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";
const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(1));

export default async function SubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { team: true, scores: { include: { criterion: true }, orderBy: { criterion: { order: "asc" } } } },
  });
  if (!submission) notFound();

  // Immutable evaluation versions for this submission (newest first).
  const versions = await prisma.evaluationEvent.findMany({
    where: { submissionId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, finalScore: true, totalScore: true, confidence: true,
      model: true, rubricVersion: true, promptVersion: true, commitSha: true,
      flags: true, createdAt: true, completedAt: true,
    },
  });

  const evidence = (submission.evidence ?? null) as
    | {
        fileCount?: number;
        commitCount?: number;
        contributorCount?: number;
        keyFiles?: string[];
        hasReadme?: boolean;
        completeness?: {
          status: string;
          confidence: number;
          missing: string[];
          criteria: { criterionId: string; name: string; level: string; note: string }[];
        };
      }
    | null;
  const completeness = evidence?.completeness ?? null;
  const levelColor: Record<string, string> = { DIRECT: "var(--good)", INDIRECT: "var(--warn)", NONE: "var(--bad)" };

  return (
    <div className="fade-in-up">
      <Link href="/organizer/evaluations" className="link text-sm">← Evaluations</Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-6 border-b border-[var(--glass-border)] pb-6">
        <div className="min-w-0">
          <div className="mono text-xs text-ink-3">{submission.team.teamCode}</div>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink">{submission.team.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>{submission.team.university}</span>
            <span className="chip">{submission.team.track}</span>
          </div>
          <a href={submission.repoUrl} target="_blank" className="mono mt-2 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
            {submission.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}<Icon.external size={11} />
          </a>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="mb-2"><StatusBadge status={submission.status} /></div>
            <ReEvaluateButton submissionId={submission.id} disabled={submission.status === "EVALUATING"} />
            {submission.model && <div className="mono mt-2 text-[11px] text-ink-3">{submission.model}</div>}
          </div>
          <ScoreRing value={submission.totalScore} label="/ 100" color={submission.totalScore != null ? totalBandVar(submission.totalScore) : "var(--brand)"} />
        </div>
      </header>

      {submission.status === "FAILED" && (
        <p className="mt-4 rounded-lg border border-bad/40 bg-surface px-4 py-3 text-sm text-bad">{submission.error ?? "Evaluation failed."}</p>
      )}

      {submission.status === "REVIEW_REQUIRED" && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-surface px-4 py-3 text-sm" style={{ color: "var(--warn)" }}>
          <div className="flex flex-wrap items-center gap-2">
            {submission.flags.map((f) => (
              <span key={f} className="mono rounded border border-warn/40 px-1.5 py-0.5 text-xs">{f}</span>
            ))}
          </div>
          <p className="mt-2">{submission.error ?? "Held for manual review; not sent to the model."}</p>
        </div>
      )}

      {evidence && (
        <div className="mt-6 card p-4">
          <div className="mb-3 text-sm font-semibold text-ink">Evidence gathered</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {[
              ["Files", evidence.fileCount ?? 0],
              ["Commits", evidence.commitCount ?? "—"],
              ["Contributors", evidence.contributorCount ?? "—"],
              ["README", evidence.hasReadme ? "present" : "absent"],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="nums mt-0.5 text-lg font-bold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {evidence.keyFiles?.length ? <div className="mono mt-3 text-xs text-ink-3">Analyzed: {evidence.keyFiles.join(", ")}</div> : null}
        </div>
      )}

      {completeness && (
        <div className="mt-4 card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">Evidence completeness</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="chip mono">{completeness.status}</span>
              <span className="text-ink-3">confidence <span className="nums font-semibold text-ink">{completeness.confidence.toFixed(2)}</span></span>
            </div>
          </div>
          {completeness.missing.length > 0 && (
            <p className="mb-3 text-xs text-ink-3">Missing: {completeness.missing.join(", ")}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {completeness.criteria.map((c) => (
              <li key={c.criterionId} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 font-semibold" style={{ color: levelColor[c.level] ?? "var(--ink-3)" }}>{c.level}</span>
                <span className="text-ink-2">{c.name}</span>
                <span className="ml-auto text-ink-3">{c.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-ink-3">Confidence reflects how directly the evidence supports scoring — not model certainty. It does not alter the scores.</p>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Per-criterion scores</h2>
      {submission.scores.length === 0 ? (
        <div className="card px-4 py-10 text-center text-sm text-ink-3">No scores yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {submission.scores.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold text-ink">{s.criterion.name}</span>
                <div className="flex items-center gap-2">
                  <span className="mono grid h-7 w-7 place-items-center rounded-md text-sm font-bold text-white" style={{ background: bandVar(s.score, s.criterion.scaleMax) }}>{s.score}</span>
                  <span className="mono text-xs text-ink-3">of {s.criterion.scaleMax}</span>
                  <span className="chip mono">weight {s.criterion.weight}%</span>
                </div>
              </div>
              <ProgressBar value={s.score} max={s.criterion.scaleMax} color={bandVar(s.score, s.criterion.scaleMax)} className="mt-3" />
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.reasoning}</p>
            </div>
          ))}
        </div>
      )}

      {versions.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">
            Evaluation versions <span className="font-normal text-ink-3">({versions.length})</span>
          </h2>
          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[auto_1fr_auto_auto_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
              <span>When</span><span>Version (rubric · prompt · model)</span><span>Status</span><span className="text-right">Score</span><span className="text-right">ID</span>
            </div>
            <div className="divide-y divide-[var(--glass-border)]">
              {versions.map((v) => (
                <div key={v.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-xs sm:grid-cols-[auto_1fr_auto_auto_auto] sm:items-center sm:gap-4">
                  <span className="text-ink-3">{new Date(v.createdAt).toLocaleString()}</span>
                  <span className="mono text-ink-2">
                    {v.rubricVersion ?? "—"} · {v.promptVersion ?? "—"} · {v.model ?? "—"}
                    {v.commitSha ? ` · ${v.commitSha.slice(0, 7)}` : ""}
                    {v.flags.length ? ` · ${v.flags.join(",")}` : ""}
                  </span>
                  <span><StatusBadge status={v.status ?? "PENDING"} /></span>
                  <span className="nums text-right font-semibold text-ink">{v.finalScore == null ? "—" : v.finalScore.toFixed(1)}</span>
                  <span className="mono text-right text-ink-3">{v.id.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Each re-evaluation appends a new immutable version; older versions are never overwritten.</p>
        </>
      )}
    </div>
  );
}

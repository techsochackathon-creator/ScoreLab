import { getIntegrityData, type IntegrityData } from "@/lib/integrityStats";
import { getDataset, summary, outliers } from "@/lib/stats";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { StatCard, EmptyState, SectionTitle } from "@/components/ui/misc";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
        style={{ background: ok ? "var(--brand-tint)" : "color-mix(in srgb, var(--warn) 18%, transparent)", color: ok ? "var(--brand)" : "var(--warn)" }}
      >
        {ok ? <Icon.check size={12} /> : <Icon.alert size={12} />}
      </span>
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-xs text-ink-3">{detail}</div>
      </div>
    </li>
  );
}

function MiniBar({ value, max, color = "var(--brand)" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-surface-2">
      <div className="h-2 rounded-full transition-all" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

function VersionTable({ rows }: { rows: { label: string; count: number }[] }) {
  if (rows.length === 0) return <p className="text-xs text-ink-3">No data yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between text-xs">
          <code className="truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-ink-2">{r.label}</code>
          <span className="nums ml-2 shrink-0 font-medium text-ink">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IntegrityPage() {
  const [data, ds] = await Promise.all([getIntegrityData(), getDataset()]);
  const { pipeline, flags, confidence, versions, batch, distribution } = data;

  const totals = ds.teams.map((t) => t.totalScore);
  const s = summary(totals);
  const out = outliers(ds);

  // Rubric compliance: evaluated teams whose submission scored every criterion.
  const expected = ds.criteria.length;
  const compliant = ds.teams.filter((t) => Object.keys(t.scores).length >= expected).length;
  const compliancePct = ds.teams.length ? Math.round((compliant / ds.teams.length) * 100) : 100;
  const weightSum = ds.criteria.reduce((a, c) => a + c.weight, 0);

  const hasData = pipeline.totalRuns > 0 || ds.teams.length > 0;

  // Integrity checks.
  const checks = [
    { ok: true, label: "Automated evaluation consistency", detail: "Human judge scoring is not used — all evaluations are produced by a single automated pipeline." },
    { ok: true, label: "Rubric standardized", detail: "One rubric applied to every team." },
    { ok: weightSum === 100, label: "Criterion weights valid", detail: `Criteria weights sum to ${weightSum}%.` },
    { ok: flags.identityLeakage === 0, label: "Identity gate", detail: flags.identityLeakage === 0 ? "No identity leakage detected." : `${flags.identityLeakage} evaluation(s) withheld due to identity leakage.` },
    { ok: flags.invalidAiOutput === 0, label: "AI output validation", detail: flags.invalidAiOutput === 0 ? "All model outputs passed schema validation." : `${flags.invalidAiOutput} evaluation(s) flagged for invalid AI output.` },
    { ok: true, label: "Score distribution monitored", detail: `σ ${s.sd.toFixed(1)} across ${s.count} evaluated teams.` },
    { ok: true, label: "Outlier detection active", detail: `${out.list.length} flagged for review.` },
  ];

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Evaluation integrity</h1>
        <p className="mt-1 text-sm text-ink-2">
          Pipeline health, evidence quality, and score distribution monitoring.
        </p>
      </header>

      {!hasData ? (
        <EmptyState icon="integrity" title="Nothing to monitor yet" description="Integrity signals appear once evaluations have run." />
      ) : (
        <>
          {/* ── Pipeline overview ────────────────────────────────── */}
          <SectionTitle>Evaluation pipeline</SectionTitle>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Total runs" value={pipeline.totalRuns} icon="spark" accent />
            <StatCard label="Evaluated" value={pipeline.evaluated} icon="check" foot={pct(pipeline.evaluated, pipeline.totalRuns)} />
            <StatCard label="Failed" value={pipeline.failed} icon="alert" foot={pct(pipeline.failed, pipeline.totalRuns)} />
            <StatCard label="Review required" value={pipeline.reviewRequired} icon="evaluations" foot={pct(pipeline.reviewRequired, pipeline.totalRuns)} />
            <StatCard label="In progress" value={pipeline.evaluating} icon="spark" />
          </div>

          {/* ── Evidence quality & flags ─────────────────────────── */}
          <div className="mt-6">
            <SectionTitle>Evidence quality &amp; pipeline flags</SectionTitle>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <FlagCard label="Identity leakage detections" count={flags.identityLeakage} total={pipeline.totalRuns} color="var(--bad)" />
            <FlagCard label="Insufficient evidence" count={flags.insufficientEvidence} total={pipeline.totalRuns} color="var(--warn)" />
            <FlagCard label="Low evidence confidence" count={confidence.lowCount} total={confidence.count} color="var(--warn)" />
            <FlagCard label="Invalid AI outputs" count={flags.invalidAiOutput} total={pipeline.totalRuns} color="var(--bad)" />
            <FlagCard label="Limited evidence" count={flags.limitedEvidence} total={pipeline.totalRuns} color="var(--info)" />
            <FlagCard label="Evaluation failures" count={pipeline.failed} total={pipeline.totalRuns} color="var(--bad)" />
          </div>

          {/* ── Evidence confidence distribution ─────────────────── */}
          {confidence.count > 0 && (
            <div className="mt-6 card p-6">
              <SectionTitle>Evidence confidence distribution</SectionTitle>
              <p className="mb-4 text-xs text-ink-3">
                Confidence represents evidence sufficiency and directness — how much real evidence backs a scoring decision.
                It does not represent AI certainty and is never multiplied into scores.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs font-medium text-ink-2">Low (&lt; 0.4)</div>
                  <div className="mt-1 nums text-lg font-bold text-ink">{confidence.lowCount}</div>
                  <MiniBar value={confidence.lowCount} max={confidence.count} color="var(--warn)" />
                </div>
                <div>
                  <div className="text-xs font-medium text-ink-2">Medium (0.4–0.7)</div>
                  <div className="mt-1 nums text-lg font-bold text-ink">{confidence.mediumCount}</div>
                  <MiniBar value={confidence.mediumCount} max={confidence.count} color="var(--info)" />
                </div>
                <div>
                  <div className="text-xs font-medium text-ink-2">High (≥ 0.7)</div>
                  <div className="mt-1 nums text-lg font-bold text-ink">{confidence.highCount}</div>
                  <MiniBar value={confidence.highCount} max={confidence.count} color="var(--good)" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-6 text-xs text-ink-3">
                <span>Avg: <span className="nums font-medium text-ink">{confidence.avg.toFixed(2)}</span></span>
                <span>Min: <span className="nums font-medium text-ink">{confidence.min.toFixed(2)}</span></span>
                <span>Max: <span className="nums font-medium text-ink">{confidence.max.toFixed(2)}</span></span>
              </div>
            </div>
          )}

          {/* ── Integrity checks + compliance ring ──────────────── */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card flex items-center gap-6 p-6">
              <ScoreRing value={compliancePct} label="compliance" color="var(--brand)" />
              <div>
                <div className="text-sm font-semibold text-ink">Rubric compliance</div>
                <p className="mt-1 max-w-[15rem] text-xs text-ink-3">
                  Share of evaluations that scored every rubric criterion.
                </p>
              </div>
            </div>

            <div className="card p-6 lg:col-span-2">
              <SectionTitle>Integrity checks</SectionTitle>
              <ul className="flex flex-col gap-3">
                {checks.map((c) => (
                  <CheckRow key={c.label} ok={c.ok} label={c.label} detail={c.detail} />
                ))}
              </ul>
            </div>
          </div>

          {/* ── Score distribution ───────────────────────────────── */}
          <div className="mt-6">
            <SectionTitle>Score distribution</SectionTitle>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Median" value={distribution.median.toFixed(1)} icon="analytics" />
            <StatCard label="Std deviation" value={distribution.sd.toFixed(1)} icon="spark" />
            <StatCard label="IQR" value={distribution.iqr.toFixed(1)} icon="trendUp" foot={`Q1 ${distribution.q1} — Q3 ${distribution.q3}`} />
            <StatCard label="Outliers" value={out.list.length} icon="alert" foot={out.list.length > 0 ? `Fences: ${out.lowFence.toFixed(1)}–${out.highFence.toFixed(1)}` : "Within expected range"} />
          </div>

          {/* ── Histogram ────────────────────────────────────────── */}
          {distribution.count > 0 && (
            <div className="mt-4 card p-6">
              <SectionTitle>Score histogram</SectionTitle>
              <div className="flex items-end gap-1" style={{ height: 120 }}>
                {distribution.bins.map((count, i) => {
                  const maxBin = Math.max(...distribution.bins, 1);
                  const h = (count / maxBin) * 100;
                  return (
                    <div key={i} className="group relative flex flex-1 flex-col items-center">
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${Math.max(h, 2)}%`,
                          background: count > 0 ? "var(--brand)" : "var(--surface-2)",
                          opacity: count > 0 ? 0.8 : 0.4,
                          transition: "height 600ms cubic-bezier(0.22,1,0.36,1)",
                        }}
                      />
                      <span className="mt-1 text-[10px] text-ink-3">{i * 10}</span>
                      {/* Tooltip */}
                      <span className="pointer-events-none absolute -top-6 rounded bg-ink px-1.5 py-0.5 text-[10px] font-medium text-surface opacity-0 transition-opacity group-hover:opacity-100">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-ink-3">
                <span>0</span>
                <span>Score range</span>
                <span>100</span>
              </div>
            </div>
          )}

          {/* ── IQR outliers ─────────────────────────────────────── */}
          <div className="mt-4 card p-6">
            <SectionTitle>Score variance review</SectionTitle>
            {out.list.length === 0 ? (
              <p className="py-4 text-sm text-ink-3">
                No score outliers detected. All team totals fall within the expected range
                (IQR fences {out.lowFence.toFixed(1)}–{out.highFence.toFixed(1)}).
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--glass-border)]">
                {out.list.map((t) => (
                  <li key={t.teamId} className="flex items-center gap-3 py-3">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                      style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn)" }}
                    >
                      <Icon.alert size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{t.teamName}</div>
                      <div className="text-xs text-ink-3">
                        Score variance detected — {t.delta >= 0 ? "+" : ""}
                        {t.delta.toFixed(1)} vs. median. Review recommended.
                      </div>
                    </div>
                    <span className="nums text-sm font-bold text-ink">{t.totalScore.toFixed(1)}</span>
                    <a href={`/organizer/teams/${t.teamId}`} className="link-brand text-xs">
                      Review
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Versioning & provenance ──────────────────────────── */}
          <div className="mt-6">
            <SectionTitle>Versioning &amp; provenance</SectionTitle>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-5">
              <div className="mb-3 text-sm font-semibold text-ink">Model version</div>
              <VersionTable rows={versions.models.map((m) => ({ label: m.model, count: m.count }))} />
            </div>
            <div className="card p-5">
              <div className="mb-3 text-sm font-semibold text-ink">Prompt version</div>
              <VersionTable rows={versions.promptVersions.map((p) => ({ label: p.version, count: p.count }))} />
            </div>
            <div className="card p-5">
              <div className="mb-3 text-sm font-semibold text-ink">Rubric version</div>
              <VersionTable rows={versions.rubricVersions.map((r) => ({ label: r.version, count: r.count }))} />
            </div>
          </div>

          {/* ── Batch / run information ──────────────────────────── */}
          {batch.totalBatches > 0 && (
            <>
              <div className="mt-6">
                <SectionTitle>Batch run information</SectionTitle>
              </div>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Total batches" value={batch.totalBatches} icon="spark" />
                <StatCard label="Completed" value={batch.completed} icon="check" />
                <StatCard label="Cancelled" value={batch.cancelled} icon="close" />
                <StatCard label="Total jobs" value={batch.totalJobsRun} icon="evaluations" />
              </div>
              {batch.latestBatch && (
                <div className="mt-4 card p-5">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-ink-2">Latest batch:</span>
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2">{batch.latestBatch.id.slice(0, 12)}…</code>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: batch.latestBatch.status === "COMPLETED" ? "var(--good)" : batch.latestBatch.status === "RUNNING" ? "var(--info)" : batch.latestBatch.status === "PAUSED" ? "var(--warn)" : "var(--ink-3)" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                      {batch.latestBatch.status}
                    </span>
                    <span className="text-xs text-ink-3">{batch.latestBatch.totalJobs} jobs</span>
                    <span className="ml-auto text-xs text-ink-3">{fmtDate(batch.latestBatch.createdAt)}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Footer note ──────────────────────────────────────── */}
          <p className="mt-6 text-xs leading-relaxed text-ink-3">
            ScoreLab uses a single automated evaluator — integrity monitoring focuses on
            rubric consistency, evidence quality, and score-distribution analysis rather
            than comparing multiple human judges. Variance flags are statistical, not
            accusatory. Every evaluation run is immutable and versioned for auditability.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FlagCard({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-2">{label}</span>
        <span
          className="grid h-6 w-6 place-items-center rounded-full"
          style={{ background: count > 0 ? `color-mix(in srgb, ${color} 18%, transparent)` : "var(--surface-2)", color: count > 0 ? color : "var(--ink-3)" }}
        >
          {count > 0 ? <Icon.alert size={12} /> : <Icon.check size={12} />}
        </span>
      </div>
      <div className="mt-2 nums text-2xl font-bold text-ink">{count}</div>
      <div className="mt-1 text-xs text-ink-3">{pct(count, total)} of {total} runs</div>
    </div>
  );
}

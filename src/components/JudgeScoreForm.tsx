"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { ProgressBar, totalBandVar } from "@/components/ui/ProgressBar";
import { readApiError } from "@/lib/uiErrors";

export interface ScoreFormEvaluation {
  id: string;
  status: "DRAFT" | "SUBMITTED";
  finalScore: number | null;
  submittedAt: string | null;
  criteria: {
    criterionId: string;
    criterionName: string;
    description: string | null;
    weight: number;
    scaleMax: number;
    score: number | null;
  }[];
}

/** Returns an error message for a raw input value, or null if valid/empty. */
function inputError(raw: string, scaleMax: number): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return "Whole numbers only";
  if (n < 0 || n > scaleMax) return `Enter 0 – ${scaleMax}`;
  return null;
}

/** `locked`: judging is finalized — a remaining draft is shown read-only (the API rejects edits too). */
export function JudgeScoreForm({ evaluation, locked = false }: { evaluation: ScoreFormEvaluation; locked?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const submitted = evaluation.status === "SUBMITTED";
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(evaluation.criteria.map((c) => [c.criterionId, c.score == null ? "" : String(c.score)])),
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const errors = Object.fromEntries(evaluation.criteria.map((c) => [c.criterionId, inputError(values[c.criterionId] ?? "", c.scaleMax)]));
  const hasErrors = Object.values(errors).some(Boolean);
  const filled = evaluation.criteria.filter((c) => (values[c.criterionId] ?? "").trim() !== "").length;
  const complete = filled === evaluation.criteria.length;
  const runningTotal = evaluation.criteria.reduce((sum, c) => {
    const raw = values[c.criterionId] ?? "";
    return raw.trim() === "" || errors[c.criterionId] ? sum : sum + (Number(raw) / c.scaleMax) * c.weight;
  }, 0);

  async function save(): Promise<boolean> {
    const scores = evaluation.criteria.map((c) => {
      const raw = (values[c.criterionId] ?? "").trim();
      return { criterionId: c.criterionId, score: raw === "" ? null : Number(raw) };
    });
    const res = await fetch(`/api/judge/evaluations/${evaluation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores }),
    }).catch(() => null);
    if (!res?.ok) {
      toast(res ? await readApiError(res, "Could not save the draft.") : "Network error — your scores were not saved. Try again.", "error");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) { toast("Draft saved"); router.refresh(); }
  }

  async function submit() {
    setBusy(true);
    // Save the current inputs first so the submitted scores are exactly what is on screen.
    const ok = await save();
    if (ok) {
      const res = await fetch(`/api/judge/evaluations/${evaluation.id}/submit`, { method: "POST" }).catch(() => null);
      if (res?.ok) {
        toast("Evaluation submitted");
      } else {
        toast(res ? await readApiError(res, "Could not submit the evaluation.") : "Network error — the evaluation was not submitted. Try again.", "error");
      }
    }
    setBusy(false);
    setConfirming(false);
    router.refresh();
  }

  const readOnly = submitted || locked;

  return (
    <div className="mt-5">
      {submitted ? (
        <div className="card mb-4 flex flex-wrap items-center gap-5 p-5" role="status">
          <ScoreRing value={evaluation.finalScore} size={112} stroke={8} label="/ 100" color={evaluation.finalScore != null ? totalBandVar(evaluation.finalScore) : "var(--brand)"} />
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-pill status-completed">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                Submitted
              </span>
              <span className="status-pill status-queued">Read-only</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              Final score <span className="nums font-semibold text-ink">{evaluation.finalScore?.toFixed(2)}</span> / 100
            </p>
            {evaluation.submittedAt && (
              <p className="mt-0.5 text-xs text-ink-3">
                Submitted {new Date(evaluation.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.
              </p>
            )}
            <p className="mt-2 text-sm font-medium text-ink">This evaluation has been submitted and cannot be changed.</p>
            {locked && <p className="mt-0.5 text-xs text-ink-3">Judging has been finalized.</p>}
          </div>
        </div>
      ) : locked ? (
        <div className="notice notice-warn mb-4" role="status">
          <span className="font-semibold">Read-only.</span> Judging has been finalized. This draft was not submitted and can no longer be changed.
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="status-pill status-review">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            DRAFT
          </span>
          <p className="min-w-0 flex-1 basis-64 text-sm text-ink-2">
            Score each criterion on its own scale. Save a draft any time; submit once every criterion is scored.
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-2.5">
        {evaluation.criteria.map((c, i) => {
          const err = errors[c.criterionId];
          const inputId = `score-${c.criterionId}`;
          const raw = (values[c.criterionId] ?? "").trim();
          const scored = raw !== "" && !err;
          return (
            <li key={c.criterionId} className="card p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span
                    aria-hidden
                    className="nums mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
                    style={scored
                      ? { background: "var(--brand-tint)", color: "var(--brand-text)", border: "1px solid rgb(var(--brand-rgb) / 0.4)" }
                      : { color: "var(--ink-3)", border: "1px solid var(--hair-strong)" }}
                  >
                    {scored ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={inputId} className="card-title block">{c.criterionName}</label>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="chip nums">Scale 0–{c.scaleMax}</span>
                      <span className="chip nums">Weight {c.weight}%</span>
                      {!scored && !readOnly && <span className="text-xs text-ink-3">Not scored</span>}
                    </div>
                    {c.description && <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-ink-2">{c.description}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col pl-9 sm:items-end sm:pl-0">
                  <div className="flex items-baseline gap-2">
                    <input
                      id={inputId}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={c.scaleMax}
                      step={1}
                      value={values[c.criterionId] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [c.criterionId]: e.target.value }))}
                      disabled={submitted || locked || busy}
                      placeholder="—"
                      aria-invalid={!!err}
                      aria-describedby={err ? `${inputId}-max ${inputId}-err` : `${inputId}-max`}
                      className="field nums h-11 w-24 text-right text-lg font-semibold"
                    />
                    <span id={`${inputId}-max`} className="nums text-sm font-medium text-ink-2">/ {c.scaleMax}</span>
                  </div>
                  {err && <span id={`${inputId}-err`} role="alert" className="mt-1.5 text-xs font-medium" style={{ color: "var(--bad-text)" }}>⚠ {err}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!submitted && !locked && (
        <div
          className="sticky bottom-3 z-10 mt-4 rounded-[10px] border border-hair-strong bg-surface-2 p-3 sm:p-4"
          style={{ boxShadow: "var(--shadow-lg)" }}
          role="region"
          aria-label="Save or submit this evaluation"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="min-w-[9rem] flex-1">
              <div className="mb-1.5 text-xs text-ink-2">
                <span className="nums font-semibold text-ink">{filled}</span> of {evaluation.criteria.length} scored
              </div>
              <ProgressBar value={filled} max={evaluation.criteria.length || 1} height={4} label="Criteria scored" className="max-w-[14rem]" />
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Running total</div>
              <div className="nums text-xl font-semibold leading-tight text-ink">
                {runningTotal.toFixed(2)} <span className="text-sm font-normal text-ink-3">/ 100</span>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <button onClick={saveDraft} disabled={busy || hasErrors} className="btn-ghost flex-1 sm:flex-none" title={hasErrors ? "Fix the highlighted scores first" : undefined}>
                {busy && !confirming ? "Saving…" : "Save Draft"}
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy || hasErrors || !complete}
                title={hasErrors ? "Fix the highlighted scores first" : !complete ? "Score every criterion to submit" : undefined}
                className="btn-primary flex-1 sm:flex-none"
              >
                Submit Evaluation
              </button>
            </div>
          </div>

          {confirming && (
            <div className="notice notice-warn mt-3" role="alertdialog" aria-label="Confirm submission">
              <p className="text-sm font-semibold">
                Once submitted, this evaluation cannot be edited.
              </p>
              <p className="mt-1 text-xs text-ink-2">
                You are submitting a score of <span className="nums font-semibold text-ink">{runningTotal.toFixed(2)}</span> / 100.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={submit} disabled={busy} className="btn-primary">{busy ? "Submitting…" : "Confirm submit"}</button>
                <button onClick={() => setConfirming(false)} disabled={busy} className="btn-ghost">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

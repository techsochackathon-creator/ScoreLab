"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { totalBandVar } from "@/components/ui/ProgressBar";
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

  return (
    <div className="mt-6">
      {submitted ? (
        <div className="card mb-5 flex flex-wrap items-center gap-5 p-5">
          <ScoreRing value={evaluation.finalScore} label="/ 100" color={evaluation.finalScore != null ? totalBandVar(evaluation.finalScore) : "var(--brand)"} />
          <div>
            <span className="status-pill status-completed">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
              Submitted
            </span>
            <p className="mt-2 text-sm text-ink-2">
              Final score <span className="nums font-semibold text-ink">{evaluation.finalScore?.toFixed(2)}</span> / 100
            </p>
            {evaluation.submittedAt && (
              <p className="mt-0.5 text-xs text-ink-3">
                Submitted {new Date(evaluation.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.
              </p>
            )}
            <p className="mt-1 text-sm font-medium text-ink">This evaluation has been submitted and cannot be changed.</p>
            {locked && <p className="mt-0.5 text-xs text-ink-3">Judging has been finalized.</p>}
          </div>
        </div>
      ) : locked ? (
        <p className="mb-4 rounded-lg border border-warn/40 px-4 py-3 text-sm" style={{ color: "var(--warn)" }}>
          Judging has been finalized. This draft was not submitted and can no longer be changed.
        </p>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="status-pill status-review">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            DRAFT
          </span>
          <p className="text-sm text-ink-2">
            Score each criterion on its own scale. Save a draft any time; submit once every criterion is scored.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {evaluation.criteria.map((c) => {
          const err = errors[c.criterionId];
          const inputId = `score-${c.criterionId}`;
          return (
            <section key={c.criterionId} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <label htmlFor={inputId} className="text-base font-semibold text-ink">
                    {c.criterionName} <span className="font-normal text-ink-3">— {c.scaleMax} points</span>
                  </label>
                  <div className="mt-0.5 text-xs text-ink-3">Weight {c.weight}%</div>
                  {c.description && <p className="mt-2 text-sm leading-relaxed text-ink-2">{c.description}</p>}
                </div>
                <div className="flex flex-col items-end">
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
                      aria-describedby={`${inputId}-max`}
                      className="field nums w-24 text-right text-lg font-semibold"
                      style={err ? { borderColor: "var(--bad)" } : undefined}
                    />
                    <span id={`${inputId}-max`} className="nums text-sm font-medium text-ink-2">/ {c.scaleMax}</span>
                  </div>
                  {err && <span className="mt-1 text-xs text-bad">{err}</span>}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {!submitted && !locked && (
        <div className="card sticky bottom-3 z-10 mt-4 p-4 shadow-lg" role="region" aria-label="Save or submit this evaluation">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-ink-2">
              <span className="nums font-semibold text-ink">{filled}</span> of {evaluation.criteria.length} scored
              <span className="mx-2 text-ink-3">·</span>
              Running total <span className="nums font-semibold text-ink">{runningTotal.toFixed(2)}</span> / 100
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={saveDraft} disabled={busy || hasErrors} className="btn-ghost" title={hasErrors ? "Fix the highlighted scores first" : undefined}>
                {busy && !confirming ? "Saving…" : "Save Draft"}
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy || hasErrors || !complete}
                title={hasErrors ? "Fix the highlighted scores first" : !complete ? "Score every criterion to submit" : undefined}
                className="btn-primary"
              >
                Submit Evaluation
              </button>
            </div>
          </div>

          {confirming && (
            <div className="mt-4 rounded-lg border border-warn/40 px-4 py-3" style={{ background: "var(--surface-2)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--warn)" }}>
                Once submitted, this evaluation cannot be edited.
              </p>
              <p className="mt-1 text-xs text-ink-2">
                You are submitting a score of <span className="nums font-semibold text-ink">{runningTotal.toFixed(2)}</span> / 100.
              </p>
              <div className="mt-3 flex gap-2">
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

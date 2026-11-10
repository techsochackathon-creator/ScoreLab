"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";
import { friendlyApiError } from "@/lib/uiErrors";

export interface AnchorDraft { score: number; label: string }
/** `weight` is relative (stored as max score × multiplier); see src/lib/scoring.ts. */
export interface CriterionDraft { name: string; description: string; weight: number; scaleMax: number; anchors: AnchorDraft[] }
interface Editable {
  _id: string;
  name: string;
  description: string;
  /** Max score, as typed. */
  max: string;
  /** Weight multiplier, as typed (e.g. "3" for ×3). */
  mult: string;
  anchors: (AnchorDraft & { _id: string })[];
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const toEditable = (c: CriterionDraft): Editable => ({
  _id: uid(),
  name: c.name,
  description: c.description,
  max: String(c.scaleMax),
  mult: String(Math.round((c.weight / c.scaleMax) * 100) / 100),
  anchors: c.anchors.map((a) => ({ ...a, _id: uid() })),
});

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const maxOf = (c: Editable) => num(c.max);
const multOf = (c: Editable) => num(c.mult);
/** Stored weight = max × multiplier, as a whole number. */
const weightOf = (c: Editable) => {
  const m = maxOf(c);
  const x = multOf(c);
  return Number.isFinite(m) && Number.isFinite(x) ? Math.round(m * x) : 0;
};
function criterionError(c: Editable): string | null {
  const m = maxOf(c);
  const x = multOf(c);
  if (!c.name.trim()) return "Name is required";
  if (!Number.isInteger(m) || m < 1 || m > 100) return "Max score must be a whole number from 1 to 100";
  if (!Number.isFinite(x) || x < 0 || x > 100) return "Weight must be a number from 0 to 100";
  if (c.anchors.some((a) => !Number.isInteger(a.score) || a.score < 0 || a.score > m)) return `Score bands must start between 0 and ${m}`;
  return null;
}

/** `locked`: judging has started (a submitted evaluation exists) — the API rejects saves, so the form is disabled. */
export function RubricEditor({ initialName, initialCriteria, locked = false }: { initialName: string; initialCriteria: CriterionDraft[]; locked?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [criteria, setCriteria] = useState<Editable[]>(initialCriteria.map(toEditable));
  const [saving, setSaving] = useState(false);

  const totalPoints = useMemo(() => criteria.reduce((s, c) => s + weightOf(c), 0), [criteria]);
  const pct = (c: Editable) => (totalPoints > 0 ? (weightOf(c) / totalPoints) * 100 : 0);
  const errors = criteria.map(criterionError);
  const canSave = criteria.length > 0 && totalPoints > 0 && errors.every((e) => !e);

  function patch(id: string, p: Partial<Editable>) { setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, ...p } : c))); }
  function patchAnchor(id: string, aid: string, p: Partial<AnchorDraft>) {
    setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, anchors: c.anchors.map((a) => (a._id === aid ? { ...a, ...p } : a)) } : c)));
  }
  function addAnchor(id: string) {
    setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, anchors: [...c.anchors, { _id: uid(), score: 0, label: "" }] } : c)));
  }
  function removeAnchor(id: string, aid: string) {
    setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, anchors: c.anchors.filter((a) => a._id !== aid) } : c)));
  }
  function add() { setCriteria((prev) => [...prev, { _id: uid(), name: "", description: "", max: "10", mult: "1", anchors: [] }]); }
  function remove(id: string) { setCriteria((prev) => prev.filter((c) => c._id !== id)); }

  async function save() {
    setSaving(true);
    const payload = criteria.map((c) => ({
      name: c.name.trim(),
      description: c.description.trim(),
      scaleMax: maxOf(c),
      weight: weightOf(c),
      anchors: c.anchors.filter((a) => a.label.trim()).map((a) => ({ score: a.score, label: a.label.trim() })),
    }));
    const res = await fetch("/api/rubric", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: initialName, criteria: payload }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (res?.ok) { toast("Rubric saved"); router.refresh(); }
    else toast(res ? friendlyApiError(res.status, d.error, "Save failed") : "Couldn't reach the server. Try again.", "error");
  }

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="page-title">Rubric</h1>
        <p className="page-sub">
          Each criterion is scored from 0 to its max score, then multiplied by its weight. The total is scaled to 100.
        </p>
      </header>

      {locked && (
        <p className="mb-4 notice notice-warn">
          The rubric is locked because judging has already started. Judges score against the criteria below.
        </p>
      )}

      <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">

      {/* Weighting summary */}
      <div className="card sticky top-16 z-20 mb-6 p-4 lg:top-20">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink">Weighting</span>
          <span className="text-sm text-ink-2">
            Total <span className="nums font-bold text-ink">{totalPoints}</span> points
            {totalPoints > 0 && totalPoints !== 100 && <span className="text-ink-3"> → scaled to 100</span>}
          </span>
        </div>
        <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2">
          {criteria.map((c) => (
            <div key={c._id} title={`${c.name || "Criterion"} — ${pct(c).toFixed(1)}%`} style={{ width: `${pct(c)}%`, background: "var(--brand)" }} className="h-full first:rounded-l-full" />
          ))}
        </div>
        {totalPoints <= 0 && <p className="mt-2 text-xs text-bad">Give at least one criterion a weight above 0.</p>}
      </div>

      <div className="divide-y divide-hair">
        {criteria.map((c, i) => (
          <div key={c._id} className="py-6 first:pt-0">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-[220px] flex-1">
                <input value={c.name} onChange={(e) => patch(c._id, { name: e.target.value })} placeholder={`Criterion ${i + 1}`}
                  aria-label={`Criterion ${i + 1} name`}
                  className="w-full border-0 bg-transparent p-0 text-base font-semibold text-ink outline-none placeholder:text-ink-3 focus:ring-0" />
                <textarea value={c.description} onChange={(e) => patch(c._id, { description: e.target.value })} rows={3} placeholder="What this criterion measures…"
                  aria-label={`Criterion ${i + 1} description`}
                  className="mt-1 w-full resize-none border-0 bg-transparent p-0 text-sm text-ink-2 outline-none placeholder:text-ink-3 focus:ring-0" />
              </div>
              <div className="flex items-end gap-3">
                <label className="text-right">
                  <span className="mb-1 block text-[11px] font-medium text-ink-3">Weight</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-ink-3">×</span>
                    <input type="number" min={0} max={100} step="any" value={c.mult} onChange={(e) => patch(c._id, { mult: e.target.value })}
                      className="field nums w-16 py-1 text-right" />
                  </div>
                </label>
                <label className="text-right">
                  <span className="mb-1 block text-[11px] font-medium text-ink-3">Max score</span>
                  <input type="number" min={1} max={100} step={1} value={c.max} onChange={(e) => patch(c._id, { max: e.target.value })}
                    className="field nums w-16 py-1 text-right" />
                </label>
                <div className="w-16 pb-1.5 text-right">
                  <span className="mb-1 block text-[11px] font-medium text-ink-3">Share</span>
                  <span className="nums text-sm font-semibold text-ink">{pct(c).toFixed(1)}%</span>
                </div>
                <button onClick={() => remove(c._id)} className="mb-0.5 grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-bad" aria-label="Remove criterion">
                  <Icon.close size={16} />
                </button>
              </div>
            </div>
            {errors[i] && <p className="mt-2 text-xs text-bad" role="alert">{errors[i]}</p>}

            <div className="mt-4 rounded-lg border border-hair bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-ink-3">Score bands <span className="font-normal">(optional — guidance for judges and the AI)</span></span>
                <button onClick={() => addAnchor(c._id)} className="text-xs font-medium text-brand-text hover:underline">+ Add band</button>
              </div>
              {c.anchors.length === 0 ? (
                <p className="text-xs text-ink-3">No score bands.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {c.anchors.map((a) => (
                    <div key={a._id} className="flex items-center gap-2">
                      <label className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
                        from
                        <input type="number" min={0} max={maxOf(c) || 100} value={Number.isFinite(a.score) ? a.score : ""}
                          onChange={(e) => patchAnchor(c._id, a._id, { score: parseInt(e.target.value, 10) })}
                          className="mono w-14 rounded-md border border-hair bg-surface px-1.5 py-1 text-right text-xs text-ink outline-none focus:border-brand" />
                      </label>
                      <input value={a.label} onChange={(e) => patchAnchor(c._id, a._id, { label: e.target.value })} placeholder="What a score in this band looks like"
                        className="w-full rounded-md border border-hair bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
                      <button onClick={() => removeAnchor(c._id, a._id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3 hover:text-bad" aria-label="Remove score band">
                        <Icon.close size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button onClick={add} className="mt-6 flex items-center gap-2 rounded-lg border border-dashed border-hair-strong px-4 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:border-brand hover:text-ink">
        <Icon.plus size={16} /> Add criterion
      </button>

      <div className="sticky bottom-0 mt-8 flex items-center justify-end gap-3 border-t border-hair bg-bg py-3">
        <button onClick={save} disabled={saving || !canSave} className="btn-primary" title={canSave ? undefined : "Fix the highlighted criteria first"}>
          {saving ? "Saving…" : "Save rubric"}
        </button>
      </div>
      </fieldset>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icons";

export interface AnchorDraft { score: number; label: string }
export interface CriterionDraft { name: string; description: string; weight: number; scaleMax: number; anchors: AnchorDraft[] }
interface Editable extends CriterionDraft { _id: string }

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const toEditable = (c: CriterionDraft): Editable => ({ ...c, _id: uid() });
const makeAnchors = (scaleMax: number, existing: AnchorDraft[] = []): AnchorDraft[] =>
  Array.from({ length: scaleMax }, (_, i) => existing.find((a) => a.score === i + 1) ?? { score: i + 1, label: "" });

export function RubricEditor({ initialName, initialCriteria }: { initialName: string; initialCriteria: CriterionDraft[] }) {
  const router = useRouter();
  const toast = useToast();
  const [criteria, setCriteria] = useState<Editable[]>(initialCriteria.map(toEditable));
  const [saving, setSaving] = useState(false);

  const weightSum = useMemo(() => criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0), [criteria]);
  const sumOk = weightSum === 100;
  const over = weightSum > 100;

  function patch(id: string, p: Partial<Editable>) { setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, ...p } : c))); }
  function setScaleMax(id: string, scaleMax: number) { setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, scaleMax, anchors: makeAnchors(scaleMax, c.anchors) } : c))); }
  function setAnchor(id: string, score: number, label: string) { setCriteria((prev) => prev.map((c) => (c._id === id ? { ...c, anchors: c.anchors.map((a) => (a.score === score ? { ...a, label } : a)) } : c))); }
  function add() { setCriteria((prev) => [...prev, { _id: uid(), name: "", description: "", weight: 0, scaleMax: 5, anchors: makeAnchors(5) }]); }
  function remove(id: string) { setCriteria((prev) => prev.filter((c) => c._id !== id)); }

  async function save() {
    setSaving(true);
    const res = await fetch("/api/rubric", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: initialName, criteria: criteria.map(({ _id, ...c }) => (void _id, c)) }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) { toast("Rubric saved"); router.refresh(); }
    else toast(d.error ?? "Save failed", "error");
  }

  return (
    <div className="fade-in-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Rubric</h1>
        <p className="mt-1 text-sm text-ink-2">Criteria, weights, and anchor descriptions. Applies to all future evaluations.</p>
      </header>

      {/* Weight budget meter */}
      <div className="card sticky top-16 z-20 mb-6 p-4 lg:top-20">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">Weight budget</span>
          <span className="nums text-sm font-bold" style={{ color: sumOk ? "var(--good)" : "var(--bad)" }}>
            {weightSum}<span className="text-ink-3"> / 100</span>
          </span>
        </div>
        <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2">
          {criteria.map((c) => (
            <div key={c._id} title={`${c.name || "Criterion"} — ${c.weight}%`} style={{ width: `${Math.min(100, c.weight)}%`, background: over ? "var(--bad)" : "var(--brand)" }} className="h-full first:rounded-l-full" />
          ))}
        </div>
        {!sumOk && <p className="mt-2 text-xs text-bad">{over ? "Over budget — reduce weights to total 100." : "Weights must total 100 before saving."}</p>}
      </div>

      <div className="divide-y divide-hair">
        {criteria.map((c, i) => (
          <div key={c._id} className="py-6 first:pt-0">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-[220px]">
                <input value={c.name} onChange={(e) => patch(c._id, { name: e.target.value })} placeholder={`Criterion ${i + 1}`}
                  className="w-full border-0 bg-transparent p-0 text-base font-semibold text-ink outline-none placeholder:text-ink-3 focus:ring-0" />
                <textarea value={c.description} onChange={(e) => patch(c._id, { description: e.target.value })} rows={2} placeholder="What this criterion measures…"
                  className="mt-1 w-full resize-none border-0 bg-transparent p-0 text-sm text-ink-2 outline-none placeholder:text-ink-3 focus:ring-0" />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-right">
                  <span className="mb-1 block text-[11px] font-medium text-ink-3">Weight</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={100} value={c.weight} onChange={(e) => patch(c._id, { weight: parseInt(e.target.value, 10) || 0 })}
                      className="field w-16 py-1 text-right" />
                    <span className="text-sm text-ink-3">%</span>
                  </div>
                </label>
                <label className="text-right">
                  <span className="mb-1 block text-[11px] font-medium text-ink-3">Scale</span>
                  <select value={c.scaleMax} onChange={(e) => setScaleMax(c._id, parseInt(e.target.value, 10))} className="field w-20 py-1">
                    {[3, 4, 5, 6, 10].map((n) => (<option key={n} value={n}>1–{n}</option>))}
                  </select>
                </label>
                <button onClick={() => remove(c._id)} className="mt-4 grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-bad" aria-label="Remove criterion">
                  <Icon.close size={16} />
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-hair bg-surface-2 p-3">
              <div className="mb-2 text-[11px] font-medium text-ink-3">Anchor descriptions</div>
              <div className="flex flex-col gap-1.5">
                {c.anchors.map((a) => (
                  <div key={a.score} className="flex items-center gap-2.5">
                    <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-md border border-hair bg-surface text-xs font-semibold text-ink-2">{a.score}</span>
                    <input value={a.label} onChange={(e) => setAnchor(c._id, a.score, e.target.value)} placeholder={`What a ${a.score} looks like`}
                      className="w-full rounded-md border border-hair bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={add} className="mt-6 flex items-center gap-2 rounded-lg border border-dashed border-hair-strong px-4 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:border-brand hover:text-ink">
        <Icon.plus size={16} /> Add criterion
      </button>

      <div className="sticky bottom-0 mt-8 flex items-center justify-end gap-3 border-t border-hair bg-bg/90 py-4 backdrop-blur">
        <button onClick={save} disabled={saving || !sumOk || criteria.length === 0} className="btn-primary">
          {saving ? "Saving…" : "Save rubric"}
        </button>
      </div>
    </div>
  );
}

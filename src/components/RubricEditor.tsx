"use client";

import { useMemo, useState } from "react";
import type { CheckType } from "@prisma/client";
import type { RubricLockState } from "@/lib/rubricLock";
import {
  CHECK_TYPES,
  CHECK_TYPE_META,
  RESPONSIVENESS_PRESETS,
  defaultScoringRules,
  validateRubricCriteria,
  type CriterionInput,
  type LighthouseRules,
  type UptimeRules,
  type ResponsivenessRules,
  type BuildSuccessRules,
  type CodeQualityRules,
  type CodeQualitySubCheck,
  type HumanScoreRules,
} from "@/lib/scoringRules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CriterionDraft {
  name: string;
  checkType: CheckType;
  weightPercent: number;
  scoringRules: unknown;
}

export interface TrackRubric {
  trackId: string;
  trackName: string;
  rubricName: string;
  lock: RubricLockState;
  criteria: CriterionDraft[];
}

interface EditableCriterion extends CriterionDraft {
  _id: string;
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function toEditable(c: CriterionDraft): EditableCriterion {
  return { ...c, _id: uid() };
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function RubricEditor({
  initialTracks,
}: {
  initialTracks: TrackRubric[];
}) {
  const [tracks, setTracks] = useState<TrackRubric[]>(initialTracks);
  const [activeTrackId, setActiveTrackId] = useState<string>(
    initialTracks[0]?.trackId ?? "",
  );
  const [criteria, setCriteria] = useState<EditableCriterion[]>(
    (initialTracks[0]?.criteria ?? []).map(toEditable),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [status, setStatus] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  const active = tracks.find((t) => t.trackId === activeTrackId);
  const locked = active?.lock.locked ?? false;

  function switchTrack(trackId: string) {
    if (trackId === activeTrackId) return;
    if (dirty && !confirm("Discard unsaved changes to this rubric?")) return;
    const t = tracks.find((x) => x.trackId === trackId);
    setActiveTrackId(trackId);
    setCriteria((t?.criteria ?? []).map(toEditable));
    setDirty(false);
    setStatus(null);
  }

  function patchCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((prev) =>
      prev.map((c) => (c._id === id ? { ...c, ...patch } : c)),
    );
    setDirty(true);
    setStatus(null);
  }

  function changeCheckType(id: string, checkType: CheckType) {
    // Reset scoringRules to a fresh valid default for the new checkType.
    patchCriterion(id, { checkType, scoringRules: defaultScoringRules(checkType) });
  }

  function addCriterion() {
    const checkType: CheckType = "lighthouse_perf";
    setCriteria((prev) => [
      ...prev,
      {
        _id: uid(),
        name: "",
        checkType,
        weightPercent: 0,
        scoringRules: defaultScoringRules(checkType),
      },
    ]);
    setDirty(true);
    setStatus(null);
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c._id !== id));
    setDirty(true);
    setStatus(null);
  }

  // Live validation.
  const validation = useMemo(() => {
    const input: CriterionInput[] = criteria.map((c) => ({
      name: c.name,
      checkType: c.checkType,
      weightPercent: Number(c.weightPercent) || 0,
      scoringRules: c.scoringRules,
    }));
    return validateRubricCriteria(input);
  }, [criteria]);

  const errorByIndex = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of validation.errors) {
      const arr = m.get(e.index) ?? [];
      arr.push(`${e.field}: ${e.message}`);
      m.set(e.index, arr);
    }
    return m;
  }, [validation]);

  async function save() {
    if (!active || locked) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/rubrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: active.trackId,
          criteria: criteria.map(({ _id, ...c }) => {
            void _id;
            return c;
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTracks((prev) =>
          prev.map((t) =>
            t.trackId === active.trackId
              ? { ...t, criteria: criteria.map(({ _id, ...c }) => (void _id, c)) }
              : t,
          ),
        );
        setDirty(false);
        setStatus({
          kind: "success",
          text: `Saved ${data.criteriaCount} criteria.`,
        });
      } else if (res.status === 409) {
        // Became locked meanwhile — reflect it.
        if (data.lock) {
          setTracks((prev) =>
            prev.map((t) =>
              t.trackId === active.trackId ? { ...t, lock: data.lock } : t,
            ),
          );
        }
        setStatus({ kind: "error", text: data.error ?? "Rubric is locked." });
      } else {
        setStatus({ kind: "error", text: data.error ?? "Save failed." });
      }
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function lock() {
    if (!active || locked) return;
    if (
      !confirm(
        "Lock this rubric? Once locked it cannot be edited. (Evaluation runs also lock it automatically.)",
      )
    )
      return;
    setLocking(true);
    setStatus(null);
    try {
      const res = await fetch("/api/rubrics/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: active.trackId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.lock) {
        setTracks((prev) =>
          prev.map((t) =>
            t.trackId === active.trackId ? { ...t, lock: data.lock } : t,
          ),
        );
        setStatus({ kind: "success", text: "Rubric locked." });
      } else {
        setStatus({ kind: "error", text: data.error ?? "Lock failed." });
      }
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setLocking(false);
    }
  }

  if (!active) return null;

  const sum = validation.weightSum;
  const sumOk = Math.abs(sum - 100) < 0.01;

  return (
    <div>
      {/* Track tabs */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800">
        {tracks.map((t) => (
          <button
            key={t.trackId}
            onClick={() => switchTrack(t.trackId)}
            className={`flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-medium ${
              t.trackId === activeTrackId
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {t.trackName}
            {t.lock.locked && <span title="Locked">🔒</span>}
          </button>
        ))}
      </div>

      {locked && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <strong>Rubric locked.</strong>{" "}
          {active.lock.reason === "evaluations-started"
            ? `Evaluation has started for this track (${active.lock.evaluationJobs} job(s)). The rubric is read-only to keep scoring consistent.`
            : "This rubric was frozen manually. It is read-only."}
        </div>
      )}

      {/* Criteria */}
      <div className="flex flex-col gap-4">
        {criteria.map((c, i) => (
          <CriterionCard
            key={c._id}
            criterion={c}
            index={i}
            locked={locked}
            errors={errorByIndex.get(i)}
            onChangeName={(name) => patchCriterion(c._id, { name })}
            onChangeWeight={(weightPercent) =>
              patchCriterion(c._id, { weightPercent })
            }
            onChangeCheckType={(ct) => changeCheckType(c._id, ct)}
            onChangeRules={(scoringRules) =>
              patchCriterion(c._id, { scoringRules })
            }
            onRemove={() => removeCriterion(c._id)}
          />
        ))}
        {criteria.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
            No criteria yet.
          </p>
        )}
      </div>

      {!locked && (
        <button
          onClick={addCriterion}
          className="mt-4 rounded-md border border-dashed border-gray-400 px-4 py-2 text-sm font-medium text-gray-600 hover:border-indigo-500 hover:text-indigo-600 dark:text-gray-300"
        >
          + Add criterion
        </button>
      )}

      {/* Weight summary + actions */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-6 dark:border-gray-800">
        <div className="text-sm">
          <span className="text-gray-500">Total weight: </span>
          <span
            className={
              sumOk
                ? "font-semibold text-green-600"
                : "font-semibold text-red-600"
            }
          >
            {sum.toFixed(1)}%
          </span>
          {!sumOk && (
            <span className="ml-2 text-gray-500">(must equal 100%)</span>
          )}
        </div>

        {!locked && (
          <div className="flex items-center gap-3">
            {status && (
              <span
                className={`text-sm ${
                  status.kind === "success"
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {status.text}
              </span>
            )}
            <button
              onClick={lock}
              disabled={locking || criteria.length === 0}
              className="rounded-md border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-950"
            >
              {locking ? "Locking…" : "Lock rubric"}
            </button>
            <button
              onClick={save}
              disabled={saving || !validation.ok}
              className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save rubric"}
            </button>
          </div>
        )}
      </div>

      {!locked && !validation.ok && validation.formError && (
        <p className="mt-2 text-right text-xs text-red-600">
          {validation.formError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criterion card
// ---------------------------------------------------------------------------

function CriterionCard({
  criterion,
  index,
  locked,
  errors,
  onChangeName,
  onChangeWeight,
  onChangeCheckType,
  onChangeRules,
  onRemove,
}: {
  criterion: EditableCriterion;
  index: number;
  locked: boolean;
  errors?: string[];
  onChangeName: (v: string) => void;
  onChangeWeight: (v: number) => void;
  onChangeCheckType: (v: CheckType) => void;
  onChangeRules: (v: unknown) => void;
  onRemove: () => void;
}) {
  const meta = CHECK_TYPE_META[criterion.checkType];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Criterion name
          </label>
          <input
            value={criterion.name}
            disabled={locked}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder={`Criterion ${index + 1}`}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Check type
          </label>
          <select
            value={criterion.checkType}
            disabled={locked}
            onChange={(e) => onChangeCheckType(e.target.value as CheckType)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          >
            <optgroup label="Automated">
              {CHECK_TYPES.filter((ct) => CHECK_TYPE_META[ct].automated).map(
                (ct) => (
                  <option key={ct} value={ct}>
                    {CHECK_TYPE_META[ct].label}
                  </option>
                ),
              )}
            </optgroup>
            <optgroup label="Manual">
              {CHECK_TYPES.filter((ct) => !CHECK_TYPE_META[ct].automated).map(
                (ct) => (
                  <option key={ct} value={ct}>
                    {CHECK_TYPE_META[ct].label}
                  </option>
                ),
              )}
            </optgroup>
          </select>
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Weight %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            disabled={locked}
            value={criterion.weightPercent}
            onChange={(e) => onChangeWeight(parseFloat(e.target.value) || 0)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        {!locked && (
          <button
            onClick={onRemove}
            title="Remove criterion"
            className="rounded-md px-2 py-1.5 text-sm text-gray-400 hover:text-red-600"
          >
            ✕
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-500">{meta.description}</p>

      {/* checkType-specific config */}
      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <ScoringRulesEditor
          checkType={criterion.checkType}
          rules={criterion.scoringRules}
          disabled={locked}
          onChange={onChangeRules}
        />
      </div>

      {errors && errors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoring-rules editors (dispatch by checkType)
// ---------------------------------------------------------------------------

function ScoringRulesEditor({
  checkType,
  rules,
  disabled,
  onChange,
}: {
  checkType: CheckType;
  rules: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  switch (checkType) {
    case "lighthouse_perf":
    case "lighthouse_a11y":
      return (
        <LighthouseConfig
          rules={rules as LighthouseRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "uptime":
      return (
        <UptimeConfig
          rules={rules as UptimeRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "responsiveness":
      return (
        <ResponsivenessConfig
          rules={rules as ResponsivenessRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "build_success":
      return (
        <BuildConfig
          rules={rules as BuildSuccessRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "code_quality":
      return (
        <CodeQualityConfig
          rules={rules as CodeQualityRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "human_score":
      return (
        <HumanConfig
          rules={rules as HumanScoreRules}
          disabled={disabled}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

function Num({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  step = 1,
  width = "w-28",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  min?: number;
  step?: number;
  width?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`${width} rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`}
      />
    </label>
  );
}

// --- lighthouse_perf / lighthouse_a11y ---
function LighthouseConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: LighthouseRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const mode = rules?.mode ?? "raw";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`lh-${Math.random()}`}
            checked={mode === "raw"}
            disabled={disabled}
            onChange={() => onChange({ mode: "raw", maxPoints: 100 })}
          />
          Raw score × weight
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === "bands"}
            disabled={disabled}
            onChange={() =>
              onChange({
                mode: "bands",
                bands: [
                  { min: 90, score: 100 },
                  { min: 75, score: 80 },
                  { min: 50, score: 50 },
                  { min: 0, score: 20 },
                ],
              })
            }
          />
          Custom threshold bands
        </label>
      </div>

      {mode === "raw" ? (
        <p className="text-xs text-gray-500">
          The Lighthouse score (0–100) is used directly, then scaled by this
          criterion’s weight.
        </p>
      ) : (
        <BandsEditor
          bands={(rules as Extract<LighthouseRules, { mode: "bands" }>).bands}
          disabled={disabled}
          onChange={(bands) => onChange({ mode: "bands", bands })}
        />
      )}
    </div>
  );
}

function BandsEditor({
  bands,
  disabled,
  onChange,
}: {
  bands: { min: number; score: number }[];
  disabled: boolean;
  onChange: (v: { min: number; score: number }[]) => void;
}) {
  function update(i: number, patch: Partial<{ min: number; score: number }>) {
    onChange(bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500">
        <span>Raw metric ≥</span>
        <span>Award points</span>
        <span />
      </div>
      {bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            disabled={disabled}
            value={b.min}
            onChange={(e) => update(i, { min: parseFloat(e.target.value) || 0 })}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={b.score}
            onChange={(e) =>
              update(i, { score: parseFloat(e.target.value) || 0 })
            }
            className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
          {!disabled && (
            <button
              onClick={() => onChange(bands.filter((_, idx) => idx !== i))}
              className="px-2 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          onClick={() => onChange([...bands, { min: 0, score: 0 }])}
          className="self-start text-xs font-medium text-indigo-600 hover:underline"
        >
          + Add band
        </button>
      )}
    </div>
  );
}

// --- uptime ---
function UptimeConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: UptimeRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const r = rules ?? { passPoints: 100, failPoints: 0, pings: 3, timeoutMs: 5000 };
  return (
    <div className="flex flex-wrap gap-4">
      <Num
        label="Points if up"
        value={r.passPoints}
        disabled={disabled}
        onChange={(v) => onChange({ ...r, passPoints: v })}
      />
      <Num
        label="Points if down"
        value={r.failPoints}
        disabled={disabled}
        onChange={(v) => onChange({ ...r, failPoints: v })}
      />
      <Num
        label="Pings"
        value={r.pings}
        min={1}
        disabled={disabled}
        onChange={(v) => onChange({ ...r, pings: Math.round(v) })}
      />
      <Num
        label="Timeout (ms)"
        value={r.timeoutMs}
        min={500}
        step={500}
        disabled={disabled}
        onChange={(v) => onChange({ ...r, timeoutMs: Math.round(v) })}
      />
    </div>
  );
}

// --- responsiveness ---
function ResponsivenessConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: ResponsivenessRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const r = rules ?? { viewports: [375, 768, 1024, 1440], pointsPerViewport: 25 };
  const selected = new Set(r.viewports);

  function toggle(w: number) {
    const next = new Set(selected);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    onChange({ ...r, viewports: [...next].sort((a, b) => a - b) });
  }

  const [custom, setCustom] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">
          Viewport widths to test
        </p>
        <div className="flex flex-wrap gap-2">
          {RESPONSIVENESS_PRESETS.map((w) => (
            <label
              key={w}
              className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${
                selected.has(w)
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                  : "border-gray-300 text-gray-600 dark:border-gray-700"
              } ${disabled ? "opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                className="mr-1.5 align-middle"
                checked={selected.has(w)}
                disabled={disabled}
                onChange={() => toggle(w)}
              />
              {w}px
            </label>
          ))}
          {/* custom widths not in presets */}
          {r.viewports
            .filter((w) => !RESPONSIVENESS_PRESETS.includes(w as never))
            .map((w) => (
              <span
                key={w}
                className="rounded-md border border-indigo-500 bg-indigo-50 px-3 py-1 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
              >
                {w}px
                {!disabled && (
                  <button
                    onClick={() => toggle(w)}
                    className="ml-1.5 text-indigo-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
        </div>
        {!disabled && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={240}
              placeholder="Custom width"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              onClick={() => {
                const w = parseInt(custom, 10);
                if (w >= 240 && !selected.has(w)) toggle(w);
                setCustom("");
              }}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              + Add width
            </button>
          </div>
        )}
      </div>
      <Num
        label="Points per passing viewport"
        value={r.pointsPerViewport}
        disabled={disabled}
        width="w-40"
        onChange={(v) => onChange({ ...r, pointsPerViewport: v })}
      />
      <p className="text-xs text-gray-500">
        Max {(r.viewports.length * (r.pointsPerViewport || 0)).toFixed(0)} points
        ({r.viewports.length} viewport(s)).
      </p>
    </div>
  );
}

// --- build_success ---
function BuildConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: BuildSuccessRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const r = rules ?? { passPoints: 100, failPoints: 0 };
  return (
    <div className="flex flex-wrap gap-4">
      <Num
        label="Points if build passes"
        value={r.passPoints}
        disabled={disabled}
        width="w-40"
        onChange={(v) => onChange({ ...r, passPoints: v })}
      />
      <Num
        label="Points if build fails"
        value={r.failPoints}
        disabled={disabled}
        width="w-40"
        onChange={(v) => onChange({ ...r, failPoints: v })}
      />
    </div>
  );
}

// --- code_quality ---
function CodeQualityConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: CodeQualityRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const subChecks = rules?.subChecks ?? [];

  function update(i: number, patch: Partial<CodeQualitySubCheck>) {
    onChange({
      subChecks: subChecks.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    });
  }
  function remove(i: number) {
    onChange({ subChecks: subChecks.filter((_, idx) => idx !== i) });
  }
  function add() {
    onChange({
      subChecks: [
        ...subChecks,
        { key: uid(), label: "New check", enabled: true, points: 5 },
      ],
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500">
        Sub-checks (each contributes its points when it passes)
      </p>
      {subChecks.map((s, i) => (
        <div
          key={s.key}
          className="flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800"
        >
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={disabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            title="Enabled"
          />
          <input
            value={s.label}
            disabled={disabled}
            onChange={(e) => update(i, { label: e.target.value })}
            className="flex-1 min-w-[140px] rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
          {s.minCommitsPerTeammate !== undefined && (
            <label className="flex items-center gap-1 text-xs text-gray-500">
              min commits/teammate
              <input
                type="number"
                min={1}
                disabled={disabled}
                value={s.minCommitsPerTeammate}
                onChange={(e) =>
                  update(i, {
                    minCommitsPerTeammate: Math.max(
                      1,
                      parseInt(e.target.value, 10) || 1,
                    ),
                  })
                }
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
          )}
          <label className="flex items-center gap-1 text-xs text-gray-500">
            points
            <input
              type="number"
              min={0}
              disabled={disabled}
              value={s.points}
              onChange={(e) =>
                update(i, { points: parseFloat(e.target.value) || 0 })
              }
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          {!disabled && (
            <button
              onClick={() => remove(i)}
              className="px-1 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          onClick={add}
          className="self-start text-xs font-medium text-indigo-600 hover:underline"
        >
          + Add sub-check
        </button>
      )}
    </div>
  );
}

// --- human_score ---
function HumanConfig({
  rules,
  disabled,
  onChange,
}: {
  rules: HumanScoreRules;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const r = rules ?? { maxScore: 10 };
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Num
        label="Max judge score"
        value={r.maxScore}
        min={1}
        disabled={disabled}
        onChange={(v) => onChange({ maxScore: v })}
      />
      <p className="text-xs text-gray-500">
        Judges enter 0–{r.maxScore}; scaled by weight at aggregation.
      </p>
    </div>
  );
}

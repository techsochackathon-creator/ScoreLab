"use client";

import { useState } from "react";
import type { TrackLeaderboard } from "@/lib/leaderboard";
import type { RankedEntry } from "@/lib/aggregation";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n * 100)}%`;

export function Leaderboard({
  tracks,
  initialTrackId,
  initialData,
}: {
  tracks: { id: string; name: string }[];
  initialTrackId: string;
  initialData: TrackLeaderboard | null;
}) {
  const [activeId, setActiveId] = useState(initialTrackId);
  const [cache, setCache] = useState<Record<string, TrackLeaderboard | null>>({
    [initialTrackId]: initialData,
  });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const board = cache[activeId];

  async function load(trackId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?trackId=${trackId}`);
      const data = res.ok ? await res.json() : null;
      setCache((c) => ({ ...c, [trackId]: data }));
    } finally {
      setLoading(false);
    }
  }

  function switchTrack(trackId: string) {
    setActiveId(trackId);
    setExpanded(null);
    if (!(trackId in cache)) load(trackId);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800">
        {tracks.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTrack(t.id)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              t.id === activeId
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && board && (
        <>
          {!board.hasRubric && (
            <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              This track has no rubric yet — scores can&apos;t be computed.
            </p>
          )}

          {board.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
              No submissions in this track yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 dark:border-gray-800">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-4">Team</th>
                    <th className="py-2 pr-4 text-right">Final</th>
                    <th className="py-2 pr-4 text-right">Technical</th>
                    <th className="py-2 pr-4 text-right">
                      Judge{board.humanMaxScore ? ` /${board.humanMaxScore}` : ""}
                    </th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {board.entries.map((e) => (
                    <Row
                      key={e.submissionId}
                      entry={e}
                      humanMax={board.humanMaxScore}
                      hasHumanCriterion={board.humanMaxScore != null}
                      expanded={expanded === e.submissionId}
                      onToggle={() =>
                        setExpanded((x) =>
                          x === e.submissionId ? null : e.submissionId,
                        )
                      }
                      onSaved={() => load(activeId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <TieBreakLegend />
        </>
      )}

      {!loading && !board && (
        <p className="text-sm text-red-600">Failed to load this track.</p>
      )}
    </div>
  );
}

function Row({
  entry,
  humanMax,
  hasHumanCriterion,
  expanded,
  onToggle,
  onSaved,
}: {
  entry: RankedEntry;
  humanMax: number | null;
  hasHumanCriterion: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(
    entry.humanScore != null ? String(entry.humanScore) : "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string) {
    setSaving(true);
    setErr(null);
    try {
      const body =
        next.trim() === "" ? { humanScore: null } : { humanScore: Number(next) };
      const res = await fetch(
        `/api/submissions/${entry.submissionId}/human-score`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-900">
        <td className="py-2 pr-2 font-semibold tabular-nums">
          {entry.rank}
          {entry.tieBrokenWithPrevious && (
            <span title="Separated from the entry above by a tie-break">*</span>
          )}
        </td>
        <td className="py-2 pr-4">
          <div className="font-medium">{entry.teamName}</div>
          <div className="text-xs text-gray-500">{entry.university}</div>
        </td>
        <td className="py-2 pr-4 text-right font-semibold tabular-nums">
          {fmt(entry.finalScore)}
        </td>
        <td className="py-2 pr-4 text-right tabular-nums">
          {fmt(entry.technicalScore)}
        </td>
        <td className="py-2 pr-4 text-right">
          {hasHumanCriterion ? (
            <div className="flex items-center justify-end gap-1">
              <input
                value={value}
                onChange={(ev) => setValue(ev.target.value)}
                onBlur={() => {
                  const cur = entry.humanScore != null ? String(entry.humanScore) : "";
                  if (value !== cur) save(value);
                }}
                placeholder="—"
                inputMode="decimal"
                className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm dark:border-gray-700 dark:bg-gray-900"
                disabled={saving}
              />
            </div>
          ) : (
            <span className="text-gray-400">n/a</span>
          )}
          {err && <div className="text-[10px] text-red-600">{err}</div>}
        </td>
        <td className="py-2 pr-2">
          <StatusBadge entry={entry} />
        </td>
        <td className="py-2 text-right">
          <button
            onClick={onToggle}
            className="text-xs text-indigo-600 hover:underline"
          >
            {expanded ? "Hide" : "Breakdown"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/50">
          <td colSpan={7} className="px-4 py-3">
            <Breakdown entry={entry} humanMax={humanMax} />
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ entry }: { entry: RankedEntry }) {
  if (!entry.evaluated) {
    return (
      <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        unevaluated
      </span>
    );
  }
  return (
    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
      {entry.humanScored ? "final" : "auto only"}
    </span>
  );
}

function Breakdown({
  entry,
  humanMax,
}: {
  entry: RankedEntry;
  humanMax: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-4">Criterion</th>
            <th className="py-1 pr-4 text-right">Weight</th>
            <th className="py-1 pr-4 text-right">Raw</th>
            <th className="py-1 pr-4 text-right">Score</th>
            <th className="py-1 pr-4 text-right">Normalized</th>
            <th className="py-1 text-right">Weighted (of 100)</th>
          </tr>
        </thead>
        <tbody>
          {entry.contributions.map((c) => (
            <tr key={c.criterionId} className="border-t border-gray-200 dark:border-gray-800">
              <td className="py-1 pr-4">
                {c.name}
                {!c.measured && (
                  <span className="ml-1 text-amber-600">(unmeasured → 0)</span>
                )}
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {Math.round(c.weight * 100)}%
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {c.rawMetric ?? "—"}
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {c.computedScore == null ? "—" : `${fmt(c.computedScore)}/${fmt(c.maxPoints, 0)}`}
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {pct(c.normalized)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {fmt(c.weightedContribution * 100)}
              </td>
            </tr>
          ))}
          {entry.humanWeight > 0 && (
            <tr className="border-t border-gray-200 dark:border-gray-800">
              <td className="py-1 pr-4">Judge score</td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {Math.round(entry.humanWeight * 100)}%
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {entry.humanScore == null
                  ? "—"
                  : `${entry.humanScore}/${humanMax ?? "?"}`}
              </td>
              <td className="py-1 pr-4 text-right">—</td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {pct(entry.humanNormalized)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {entry.humanScored
                  ? fmt((entry.humanWeight * (entry.humanNormalized ?? 0)) * 100)
                  : "not scored"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TieBreakLegend() {
  return (
    <details className="mt-6 text-xs text-gray-500">
      <summary className="cursor-pointer font-medium">Tie-break rules</summary>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5">
        <li>Final score (descending) — the headline metric.</li>
        <li>Performance — highest Lighthouse performance wins ties.</li>
        <li>Technical score — stronger overall automated result.</li>
        <li>Accessibility — highest Lighthouse accessibility.</li>
        <li>Reliability — uptime + build success.</li>
        <li>Earliest submission time.</li>
        <li>Team name, then submission id (deterministic).</li>
      </ol>
      <p className="mt-2">
        Rows marked <span className="font-semibold">*</span> tied on final score
        and were separated by a later rule. Unevaluated submissions always rank
        last.
      </p>
    </details>
  );
}

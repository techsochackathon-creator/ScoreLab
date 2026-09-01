"use client";

import { useState } from "react";
import Link from "next/link";
import type { TrackDashboard, DashboardEntry } from "@/lib/dashboard";
import { JobStatusBadge } from "@/components/StatusBadge";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);

export function Dashboard({
  tracks,
  initialTrackId,
  initialData,
}: {
  tracks: { id: string; name: string }[];
  initialTrackId: string;
  initialData: TrackDashboard | null;
}) {
  const [activeId, setActiveId] = useState(initialTrackId);
  const [cache, setCache] = useState<Record<string, TrackDashboard | null>>({
    [initialTrackId]: initialData,
  });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const board = cache[activeId];

  async function load(trackId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?trackId=${trackId}`);
      const data = res.ok ? await res.json() : null;
      setCache((c) => ({ ...c, [trackId]: data }));
    } finally {
      setLoading(false);
    }
  }

  function switchTrack(id: string) {
    setActiveId(id);
    setNote(null);
    if (!(id in cache)) load(id);
  }

  async function rerun(submissionId: string) {
    setBusy(submissionId);
    setNote(null);
    try {
      const res = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Re-run failed");
      else {
        setNote("Evaluation queued.");
        await load(activeId);
      }
    } finally {
      setBusy(null);
    }
  }

  async function togglePublish() {
    if (!board) return;
    const publishing = !board.published;
    if (
      publishing &&
      !confirm(
        "Publish this track? Scores will be locked (no re-runs or judge edits) and the leaderboard becomes public.",
      )
    )
      return;
    setBusy("publish");
    setNote(null);
    try {
      const res = await fetch(`/api/tracks/${activeId}/publish`, {
        method: publishing ? "POST" : "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Failed");
      else await load(activeId);
    } finally {
      setBusy(null);
    }
  }

  async function saveHuman(entry: DashboardEntry, raw: string) {
    if (!entry.submissionId) return;
    setBusy(entry.submissionId + ":h");
    setNote(null);
    try {
      const body = raw.trim() === "" ? { humanScore: null } : { humanScore: Number(raw) };
      const res = await fetch(
        `/api/submissions/${entry.submissionId}/human-score`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Save failed");
      else {
        if (data.warning) setNote(data.warning);
        await load(activeId);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {/* Track tabs */}
      <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-800">
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
          {/* Publish bar + status counts */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "none"] as const).map(
                (s) => (
                  <span key={s} className="flex items-center gap-1">
                    <JobStatusBadge status={s === "none" ? null : s} />
                    <span className="tabular-nums text-gray-500">
                      {board.statusCounts[s] ?? 0}
                    </span>
                  </span>
                ),
              )}
            </div>
            <div className="flex items-center gap-3">
              {board.published ? (
                <>
                  <Link
                    href={`/leaderboard/${board.trackId}`}
                    target="_blank"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    View public board ↗
                  </Link>
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                    published
                  </span>
                  <button
                    onClick={togglePublish}
                    disabled={busy === "publish"}
                    className="rounded-md border border-gray-400 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-900"
                  >
                    Unpublish
                  </button>
                </>
              ) : (
                <button
                  onClick={togglePublish}
                  disabled={busy === "publish"}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Publish & lock scores
                </button>
              )}
            </div>
          </div>

          {note && (
            <p className="mb-3 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {note}
            </p>
          )}
          {board.published && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Scores are locked. Re-runs and judge edits are disabled until you
              unpublish.
            </p>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500 dark:border-gray-800">
                  <th className="py-2 pr-4">Team</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Final</th>
                  <th className="py-2 pr-4 text-right">Technical</th>
                  <th className="py-2 pr-4 text-right">
                    Judge{board.humanMaxScore ? ` /${board.humanMaxScore}` : ""}
                  </th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {board.entries.map((e) => (
                  <DashRow
                    key={e.teamId}
                    entry={e}
                    published={board.published}
                    hasHuman={board.humanMaxScore != null}
                    busy={busy}
                    onRerun={() => e.submissionId && rerun(e.submissionId)}
                    onSaveHuman={(v) => saveHuman(e, v)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && !board && (
        <p className="text-sm text-red-600">Failed to load this track.</p>
      )}
    </div>
  );
}

function DashRow({
  entry,
  published,
  hasHuman,
  busy,
  onRerun,
  onSaveHuman,
}: {
  entry: DashboardEntry;
  published: boolean;
  hasHuman: boolean;
  busy: string | null;
  onRerun: () => void;
  onSaveHuman: (v: string) => void;
}) {
  const [human, setHuman] = useState(
    entry.humanScore != null ? String(entry.humanScore) : "",
  );
  const jobStatus = entry.latestJob?.status ?? null;
  const canRerun =
    !!entry.submissionId &&
    !published &&
    jobStatus !== "QUEUED" &&
    jobStatus !== "RUNNING";

  return (
    <tr className="border-b border-gray-100 dark:border-gray-900">
      <td className="py-2 pr-4">
        <div className="font-medium">{entry.teamName}</div>
        <div className="text-xs text-gray-500">{entry.university}</div>
      </td>
      <td className="py-2 pr-4">
        <JobStatusBadge status={jobStatus} />
        {entry.latestJob?.status === "FAILED" && entry.latestJob.error && (
          <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-red-500" title={entry.latestJob.error}>
            {entry.latestJob.error}
          </div>
        )}
      </td>
      <td className="py-2 pr-4 text-right font-semibold tabular-nums">
        {fmt(entry.score?.finalScore)}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {fmt(entry.score?.technicalScore)}
      </td>
      <td className="py-2 pr-4 text-right">
        {hasHuman ? (
          <input
            value={human}
            onChange={(e) => setHuman(e.target.value)}
            onBlur={() => {
              const cur = entry.humanScore != null ? String(entry.humanScore) : "";
              if (human !== cur) onSaveHuman(human);
            }}
            disabled={published || !entry.submissionId || busy === entry.submissionId + ":h"}
            placeholder="—"
            inputMode="decimal"
            className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
          />
        ) : (
          <span className="text-gray-400">n/a</span>
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          {entry.submissionId && (
            <Link
              href={`/organizer/submissions/${entry.submissionId}`}
              className="text-xs text-indigo-600 hover:underline"
            >
              Details
            </Link>
          )}
          {entry.submissionId ? (
            <button
              onClick={onRerun}
              disabled={!canRerun || busy === entry.submissionId}
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-900"
              title={
                published
                  ? "Unpublish to re-run"
                  : jobStatus === "RUNNING" || jobStatus === "QUEUED"
                    ? "Already in progress"
                    : "Re-run evaluation"
              }
            >
              {busy === entry.submissionId ? "…" : "Re-run"}
            </button>
          ) : (
            <span className="text-xs text-gray-400">no submission</span>
          )}
        </div>
      </td>
    </tr>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionDetail } from "@/lib/dashboard";
import { JobStatusBadge } from "@/components/StatusBadge";
import { CriterionCard } from "@/components/CriterionEvidence";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";

export function SubmissionDetailView({ detail }: { detail: SubmissionDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [human, setHuman] = useState(
    detail.humanScore != null ? String(detail.humanScore) : "",
  );

  const latest = detail.jobs[0] ?? null;
  const completed = detail.jobs.find((j) => j.status === "COMPLETED") ?? null;
  const canRerun =
    !detail.published &&
    latest?.status !== "QUEUED" &&
    latest?.status !== "RUNNING";

  async function rerun() {
    setBusy("rerun");
    setNote(null);
    try {
      const res = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: detail.submissionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Re-run failed");
      else {
        setNote("Evaluation queued.");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveHuman() {
    setBusy("human");
    setNote(null);
    try {
      const body =
        human.trim() === "" ? { humanScore: null } : { humanScore: Number(human) };
      const res = await fetch(
        `/api/submissions/${detail.submissionId}/human-score`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Save failed");
      else {
        setNote(data.warning ?? "Judge score saved.");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{detail.team.name}</h1>
        <p className="text-sm text-gray-500">
          {detail.team.university} · {detail.team.trackName} · submitted{" "}
          {when(detail.submittedAt)}
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <a href={detail.repoUrl} target="_blank" className="text-indigo-600 hover:underline">
            Repo ↗
          </a>
          {detail.liveUrl && (
            <a href={detail.liveUrl} target="_blank" className="text-indigo-600 hover:underline">
              Live URL ↗
            </a>
          )}
          {detail.pitchDeckBlobUrl && (
            <a href={detail.pitchDeckBlobUrl} target="_blank" className="text-indigo-600 hover:underline">
              Pitch deck ↗
            </a>
          )}
        </div>
      </header>

      {detail.published && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          This track is published — scores are locked.
        </p>
      )}

      {/* Score summary + actions */}
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <div className="flex gap-8">
          <Metric label="Final" value={fmt(detail.score?.finalScore)} big />
          <Metric label="Technical" value={fmt(detail.score?.technicalScore)} />
          {detail.humanMaxScore != null && (
            <div>
              <div className="text-xs text-gray-500">
                Judge score /{detail.humanMaxScore}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={human}
                  onChange={(e) => setHuman(e.target.value)}
                  disabled={detail.published || busy === "human"}
                  inputMode="decimal"
                  placeholder="—"
                  className="w-16 rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
                />
                {!detail.published && (
                  <button
                    onClick={saveHuman}
                    disabled={busy === "human"}
                    className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={rerun}
          disabled={!canRerun || busy === "rerun"}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-900"
          title={detail.published ? "Unpublish to re-run" : undefined}
        >
          {busy === "rerun" ? "Queuing…" : "Re-run evaluation"}
        </button>
      </section>

      {note && (
        <p className="mb-4 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
          {note}
        </p>
      )}

      {/* Job history */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">
          Evaluation jobs
        </h2>
        <div className="flex flex-col gap-2">
          {detail.jobs.length === 0 && (
            <p className="text-sm text-gray-500">No evaluation jobs yet.</p>
          )}
          {detail.jobs.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-200 px-3 py-2 text-xs dark:border-gray-800"
            >
              <JobStatusBadge status={j.status} />
              <span className="text-gray-500">created {when(j.createdAt)}</span>
              {j.startedAt && <span className="text-gray-500">started {when(j.startedAt)}</span>}
              {j.completedAt && <span className="text-gray-500">done {when(j.completedAt)}</span>}
              {j.inngestRunId && (
                <span className="font-mono text-gray-400">run {j.inngestRunId.slice(0, 12)}</span>
              )}
              {j.error && <span className="text-red-500">error: {j.error}</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Per-criterion evidence from latest completed job */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Results {completed ? "" : "(no completed job yet)"}
        </h2>
        {completed && (
          <div className="flex flex-col gap-4">
            {completed.results.map((r) => (
              <CriterionCard key={r.criterionId} result={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${big ? "text-2xl" : "text-lg"}`}>
        {value}
      </div>
    </div>
  );
}

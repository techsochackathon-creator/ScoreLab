"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { readApiError } from "@/lib/uiErrors";
import { LifecycleSteps } from "@/components/LifecycleSteps";

type Props =
  | { phase: "JUDGING_OPEN"; blockers: string[] }
  | { phase: "FINALIZED" | "PUBLISHED"; finalizedAt: string; publishedAt: string | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Judging Open → [Finalize Results] → Results Finalized → [Publish Results] → Results Published. */
export function ResultsLifecycleControl(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, confirmText: string, done: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    const res = await fetch(url, { method }).catch(() => null);
    setBusy(false);
    if (res?.ok) { toast(done); router.refresh(); }
    else toast(res ? await readApiError(res) : "Network error. Check your connection and try again.", "error");
  }

  if (props.phase === "JUDGING_OPEN") {
    const ready = props.blockers.length === 0;
    return (
      <section className="card mb-4 overflow-hidden" aria-labelledby="lifecycle-title">
        <div className="border-b border-hair px-5 py-3"><LifecycleSteps phase="JUDGING_OPEN" /></div>
        <div className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="lifecycle-title" className="text-lg font-semibold text-ink">Judging Open</h2>
              <span className={`status-pill ${ready ? "status-completed" : "status-review"}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                {ready ? "Ready to finalize" : "Not ready"}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {ready
                ? "Ready to finalize: every team has a submitted evaluation and there is a unique highest score."
                : `Not ready to finalize — ${props.blockers.length} issue${props.blockers.length === 1 ? "" : "s"} to resolve:`}
            </p>
          </div>
          <button
            onClick={() => call(
              "/api/organizer/results/finalize", "POST",
              "Finalize results?\n\nFinalization freezes the official scores and winner. This cannot be undone.\n\nAfter finalizing, judges can no longer change evaluations, and assignments, teams and the rubric are locked.",
              "Results finalized",
            )}
            disabled={busy || !ready}
            className="btn-primary"
            aria-describedby={ready ? undefined : "finalize-blockers"}
          >
            {busy ? "Finalizing…" : "Finalize Results"}
          </button>
        </div>
        {!ready && (
          <ul id="finalize-blockers" className="notice notice-warn mt-4 space-y-1.5">
            {props.blockers.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden>⚠</span>
                <span>{b.replace(/^Cannot finalize: /, "")}</span>
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>
    );
  }

  const { publishedAt } = props;
  return (
    <section className="card mb-4 overflow-hidden" aria-labelledby="lifecycle-title">
      <div className="border-b border-hair px-5 py-3"><LifecycleSteps phase={publishedAt ? "PUBLISHED" : "FINALIZED"} /></div>
      <div className="flex flex-wrap items-start gap-3 p-5">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="lifecycle-title" className="text-lg font-semibold text-ink">{publishedAt ? "Results Published" : "Results Finalized"}</h2>
            <span className={`status-pill ${publishedAt ? "status-completed" : "status-brand"}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
              {publishedAt ? "Public" : "Frozen · not public"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Finalized {when(props.finalizedAt)}. The official scores and winner are frozen; they only change if you reopen judging and finalize again.
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {publishedAt ? (
              <>
                Published {when(publishedAt)} —{" "}
                <Link href="/leaderboard" className="link-brand" target="_blank">view the public leaderboard ↗</Link>
              </>
            ) : (
              "Not published yet — the public leaderboard does not show any results."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {publishedAt ? (
            <button
              onClick={() => call(
                "/api/organizer/results/publish", "DELETE",
                "Unpublish results?\n\nThe public leaderboard will stop showing results. The finalized scores and winner are not changed.",
                "Results unpublished",
              )}
              disabled={busy}
              className="btn-ghost"
            >
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => call(
                "/api/organizer/results/publish", "POST",
                "Publish results?\n\nPublishing makes the finalized results visible on the public leaderboard to anyone with the link.",
                "Results published",
              )}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "Publishing…" : "Publish Results"}
            </button>
          )}
          <button
            onClick={() => call(
              "/api/organizer/results/reopen", "POST",
              "Reopen judging?\n\nThis DELETES the frozen official result — the final ranking, winner and scores — and unpublishes the public leaderboard.\n\nKept: all judge evaluations, assignments, teams and the rubric. Submitted evaluations stay locked.\n\nAfterwards you can disqualify teams or finish judging, then finalize again.",
              "Judging reopened",
            )}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? "Reopening…" : "Reopen judging"}
          </button>
        </div>
      </div>
    </section>
  );
}

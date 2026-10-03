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
      <section className="card mb-4 p-5" aria-labelledby="lifecycle-title">
        <LifecycleSteps phase="JUDGING_OPEN" className="mb-3" />
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="lifecycle-title" className="text-lg font-bold text-ink">Judging Open</h2>
            <p className="mt-0.5 text-sm text-ink-2">
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
          <ul id="finalize-blockers" className="mt-3 space-y-1.5 text-sm">
            {props.blockers.map((b) => (
              <li key={b} className="flex gap-2" style={{ color: "var(--warn)" }}>
                <span aria-hidden>⚠</span>
                <span>{b.replace(/^Cannot finalize: /, "")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const { publishedAt } = props;
  return (
    <section className="card mb-4 p-5" aria-labelledby="lifecycle-title">
      <LifecycleSteps phase={publishedAt ? "PUBLISHED" : "FINALIZED"} className="mb-3" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[16rem] flex-1">
          <h2 id="lifecycle-title" className="text-lg font-bold text-ink">{publishedAt ? "Results Published" : "Results Finalized"}</h2>
          <p className="mt-0.5 text-sm text-ink-2">
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
            className="btn-ghost"
            style={{ color: "var(--bad)" }}
          >
            {busy ? "Reopening…" : "Reopen judging"}
          </button>
        </div>
      </div>
    </section>
  );
}

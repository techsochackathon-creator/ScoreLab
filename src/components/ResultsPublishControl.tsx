"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/** Publish / unpublish the official results on the public /leaderboard. */
export function ResultsPublishControl({ publishedAt, canPublish }: { publishedAt: string | null; canPublish: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const publishing = !publishedAt;
    if (!confirm(publishing
      ? "Publish the official results on the public leaderboard? Anyone with the link — including judges — will see the ranking."
      : "Unpublish? The public leaderboard will stop showing results.")) return;
    setBusy(true);
    const res = await fetch("/api/organizer/results/publish", { method: publishing ? "POST" : "DELETE" });
    setBusy(false);
    if (res.ok) { toast(publishing ? "Results published" : "Results unpublished"); router.refresh(); }
    else { const d = await res.json().catch(() => ({})); toast(d.error ?? "Request failed", "error"); }
  }

  return (
    <section className="card mb-4 flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 text-sm">
        {publishedAt ? (
          <>
            <span className="status-pill status-completed mr-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />Published
            </span>
            <span className="text-ink-2">
              Live on the <Link href="/leaderboard" className="link-brand">public leaderboard</Link> since{" "}
              {new Date(publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}. It updates if more evaluations are submitted.
            </span>
          </>
        ) : (
          <span className="text-ink-2">Not published — the public leaderboard shows no results yet.</span>
        )}
      </div>
      <button onClick={toggle} disabled={busy || (!publishedAt && !canPublish)} className={publishedAt ? "btn-ghost" : "btn-primary"}>
        {publishedAt ? "Unpublish" : "Publish results"}
      </button>
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReEvaluateButton({ submissionId, disabled }: { submissionId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(d.error ?? "Re-evaluate failed");
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={run} disabled={busy || disabled} className="btn-ghost">
        {busy ? "Re-evaluating…" : "Re-evaluate"}
      </button>
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}

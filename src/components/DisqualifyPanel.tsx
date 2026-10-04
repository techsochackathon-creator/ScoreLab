"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { SectionTitle } from "@/components/ui/misc";
import { readApiError } from "@/lib/uiErrors";

export interface PanelTeam {
  teamId: string;
  teamCode: string;
  name: string;
}
export interface PanelDisqualified extends PanelTeam {
  reason: string | null;
}

/**
 * Disqualify or reinstate teams while judging is open (the server rejects it
 * after finalization). A disqualified team gets no rank, can't win, and isn't
 * required for finalization; its evaluations are kept but ignored.
 */
export function DisqualifyPanel({ teams, disqualified }: { teams: PanelTeam[]; disqualified: PanelDisqualified[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function call(teamId: string, method: "PUT" | "DELETE", body: unknown, done: string) {
    setBusy(true);
    const res = await fetch(`/api/teams/${teamId}/disqualification`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { toast(done); setOpen(null); setReason(""); router.refresh(); }
    else toast(res ? await readApiError(res, "Request failed.") : "Network error. Try again.", "error");
  }

  function confirmDisqualify(t: PanelTeam) {
    if (!confirm(`Disqualify ${t.teamCode} (${t.name})?\n\nThe team gets no rank, can't win, and is no longer required for finalization. Its evaluations are kept but ignored. You can reinstate it any time before finalizing.`)) return;
    return call(t.teamId, "PUT", { reason: reason.trim() }, `${t.teamCode} disqualified`);
  }

  return (
    <section className="card mb-4 p-5" aria-labelledby="dq-title">
      <SectionTitle><span id="dq-title">Disqualify teams</span></SectionTitle>
      <p className="mb-3 text-xs text-ink-3">
        A disqualified team is excluded from the ranking and can&apos;t win. Possible only while judging is open; after finalizing, reopen judging first.
      </p>

      {teams.length === 0 && disqualified.length === 0 && <p className="text-sm text-ink-3">No teams have been added yet.</p>}

      <ul className="divide-y divide-[var(--glass-border)]">
        {teams.map((t) => (
          <li key={t.teamId} className="py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
              <button
                onClick={() => { setOpen(open === t.teamId ? null : t.teamId); setReason(""); }}
                disabled={busy}
                className="rounded px-1.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-bad/10 hover:text-[var(--bad-text)]"
                aria-expanded={open === t.teamId}
                aria-label={`Disqualify ${t.teamCode}`}
              >
                {open === t.teamId ? "Cancel" : "Disqualify"}
              </button>
            </div>
            {open === t.teamId && (
              <div className="notice notice-warn mt-2 flex flex-wrap items-end gap-2 p-3">
                <label className="min-w-0 flex-1">
                  <span className="label">Reason (kept private, organizers only)</span>
                  <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rule violation: pre-built project" maxLength={500} autoFocus />
                </label>
                <button onClick={() => confirmDisqualify(t)} disabled={busy || reason.trim().length < 3} className="btn-primary">
                  {busy ? "Saving…" : "Disqualify team"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {disqualified.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-semibold text-ink-2">Disqualified ({disqualified.length})</div>
          <ul className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)]">
            {disqualified.map((t) => (
              <li key={t.teamId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="status-pill status-failed">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                  Disqualified
                </span>
                <span className="mono w-24 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{t.name}</span>
                  {t.reason && <span className="block truncate text-xs text-ink-3">Reason: {t.reason}</span>}
                </span>
                <button
                  onClick={() => confirm(`Reinstate ${t.teamCode} (${t.name})? It will be ranked again from its submitted evaluations.`) && call(t.teamId, "DELETE", undefined, `${t.teamCode} reinstated`)}
                  disabled={busy}
                  className="text-xs font-medium text-ink-2 hover:text-ink"
                  aria-label={`Reinstate ${t.teamCode}`}
                >
                  Reinstate
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

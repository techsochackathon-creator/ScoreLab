"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { SectionTitle } from "@/components/ui/misc";
import { readApiError } from "@/lib/uiErrors";

export interface OrganizerRow {
  id: string;
  name: string | null;
  email: string;
  active: boolean;
  createdAt: string;
}

/** Change the signed-in organizer's own password. */
export function ChangePasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = !busy && current.length > 0 && next.length >= 8 && next === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/account/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      toast("Password changed");
      setCurrent(""); setNext(""); setConfirm("");
    } else {
      toast(res ? await readApiError(res, "Could not change the password.") : "Network error. Try again.", "error");
    }
  }

  return (
    <section className="card p-5" aria-labelledby="pw-title">
      <SectionTitle><span id="pw-title">Change password</span></SectionTitle>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <span className="label">Current password</span>
          <input className="field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          <span className="label">New password</span>
          <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort} required />
          {tooShort && <span className="mt-1 block text-xs text-bad">At least 8 characters.</span>}
        </label>
        <label>
          <span className="label">Confirm new password</span>
          <input className="field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} required />
          {mismatch && <span className="mt-1 block text-xs text-bad">Passwords don&apos;t match.</span>}
        </label>
        <div className="sm:col-span-3">
          <button type="submit" disabled={!canSubmit} className="btn-primary">{busy ? "Saving…" : "Change password"}</button>
        </div>
      </form>
    </section>
  );
}

/** List organizers, add one, enable/disable others. */
export function OrganizersManager({ organizers, currentUserId }: { organizers: OrganizerRow[]; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", password: "" });

  async function call(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { toast(done); router.refresh(); return true; }
    toast(res ? await readApiError(res, "Request failed.") : "Network error. Try again.", "error");
    return false;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (await call("/api/organizers", "POST", { name: draft.name.trim(), email: draft.email.trim(), password: draft.password }, "Organizer added")) {
      setDraft({ name: "", email: "", password: "" });
      setAdding(false);
    }
  }

  function toggle(o: OrganizerRow) {
    if (o.active && !confirm(`Disable ${o.name || o.email}?\n\nThey will be signed out of the organizer area immediately and won't be able to log in until you enable them again.`)) return;
    return call(`/api/organizers/${o.id}`, "PATCH", { active: !o.active }, o.active ? "Organizer disabled" : "Organizer enabled");
  }

  return (
    <section className="card p-5" aria-labelledby="org-title">
      <SectionTitle right={<button onClick={() => setAdding((v) => !v)} className="btn-ghost text-xs">{adding ? "Cancel" : "Add organizer"}</button>}>
        <span id="org-title">Organizers</span>
      </SectionTitle>

      {adding && (
        <form onSubmit={create} className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--glass-border)] p-4 sm:grid-cols-3">
          <label><span className="label">Name</span><input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
          <label><span className="label">Email (login)</span><input className="field" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} autoComplete="off" required /></label>
          <label><span className="label">Temporary password</span><input className="field" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="At least 8 characters" autoComplete="new-password" required /></label>
          <p className="text-xs text-ink-3 sm:col-span-3">
            Organizers can manage teams, judges, the rubric and results. Share the password yourself; it&apos;s stored hashed and they can change it under Settings.
          </p>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy || draft.password.length < 8} className="btn-primary">{busy ? "Adding…" : "Add organizer"}</button>
          </div>
        </form>
      )}

      <ul className="divide-y divide-[var(--glass-border)]">
        {organizers.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm font-medium ${o.active ? "text-ink" : "text-ink-3"}`}>
                {o.name || o.email}{o.id === currentUserId && <span className="ml-2 text-xs font-normal text-ink-3">(you)</span>}
              </div>
              <div className="truncate text-xs text-ink-3">{o.email}</div>
            </div>
            <span className={`status-pill ${o.active ? "status-completed" : "status-failed"}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
              {o.active ? "Active" : "Disabled"}
            </span>
            {o.id !== currentUserId && (
              <button onClick={() => toggle(o)} disabled={busy} className="text-xs font-medium text-ink-2 hover:text-ink" aria-label={`${o.active ? "Disable" : "Enable"} ${o.name || o.email}`}>
                {o.active ? "Disable" : "Enable"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

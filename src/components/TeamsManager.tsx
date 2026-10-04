"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/misc";
import { Icon } from "@/components/ui/icons";
import { friendlyApiError } from "@/lib/uiErrors";

export interface TeamRow {
  id: string;
  teamCode: string;
  name: string;
  university: string;
  track: string;
  memberNames: string[];
  projectTitle: string | null;
  technologies: string[];
  repoUrl: string | null;
}

type Draft = { teamCode: string; name: string; members: string; projectTitle: string; repoUrl: string };
const EMPTY: Draft = { teamCode: "", name: "", members: "", projectTitle: "", repoUrl: "" };

/** `locked`: results are finalized — the API rejects team changes, so the controls are hidden. */
export function TeamsManager({ initialTeams, locked = false }: { initialTeams: TeamRow[]; locked?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [csv, setCsv] = useState("");

  function startAdd() { setEditingId("new"); setDraft(EMPTY); }
  function startEdit(t: TeamRow) {
    setEditingId(t.id);
    setDraft({
      teamCode: t.teamCode,
      name: t.name,
      members: t.memberNames.join(", "),
      projectTitle: t.projectTitle ?? "",
      repoUrl: t.repoUrl ?? "",
    });
  }

  async function save() {
    setBusy(true);
    const payload = {
      teamCode: draft.teamCode.trim(),
      name: draft.name.trim(),
      memberNames: draft.members.split(",").map((m) => m.trim()).filter(Boolean),
      projectTitle: draft.projectTitle.trim() || null,
      repoUrl: draft.repoUrl.trim() || null,
    };
    const res = await fetch(editingId === "new" ? "/api/teams" : `/api/teams/${editingId}`, {
      method: editingId === "new" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) { toast(editingId === "new" ? "Team added" : "Team updated"); setEditingId(null); router.refresh(); }
    else { const d = await res.json().catch(() => ({})); toast(friendlyApiError(res.status, d.error, "Save failed"), "error"); }
  }

  async function remove(t: TeamRow) {
    if (!confirm(`Delete "${t.name}" (${t.teamCode})?

This permanently deletes the team together with its AI submissions, judge assignments and judge evaluations. This cannot be undone.`)) return;
    const res = await fetch(`/api/teams/${t.id}`, { method: "DELETE" });
    if (res.ok) { toast("Team deleted"); router.refresh(); }
    else { const d = await res.json().catch(() => ({})); toast(friendlyApiError(res.status, d.error, "Delete failed"), "error"); }
  }

  async function importCsv() {
    setBusy(true);
    const res = await fetch("/api/teams/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { toast(`Imported ${d.created} new, ${d.updated} updated`); setCsv(""); setShowCsv(false); router.refresh(); }
    else toast(friendlyApiError(res.status, d.error, "Import failed"), "error");
  }

  const repoShort = (u: string) => u.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  const teamsWithRepo = initialTeams.filter((t) => t.repoUrl);

  return (
    <div className="fade-in-up">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-sub">
            Manage participating teams, or bulk-import from CSV.
            {initialTeams.length > 0 && (
              <span className="ml-1 text-ink-3">
                {teamsWithRepo.length}/{initialTeams.length} have repo URLs — ready for batch evaluation.
              </span>
            )}
          </p>
        </div>
        {!locked && (
          <div className="flex gap-2">
            <button onClick={() => setShowCsv((v) => !v)} className="btn-ghost">Import CSV</button>
            <button onClick={startAdd} className="btn-primary"><Icon.plus size={16} /> Add team</button>
          </div>
        )}
      </header>

      {locked && (
        <p className="mb-4 notice notice-warn">
          Results have been finalized. Teams can no longer be added, edited or deleted.
        </p>
      )}

      {showCsv && (
        <div className="card mb-4 p-4">
          <p className="mb-2 text-xs text-ink-3">Header row required. Columns: <span className="mono text-ink-2">teamCode, name, repoUrl, members</span>. Members separated by <span className="mono">;</span> or <span className="mono">|</span>. Existing codes update.</p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} placeholder={"teamCode,name,repoUrl,members\nT01,Rockets,https://github.com/team/project,Ada; Alan"} className="field mono text-xs" />
          <div className="mt-2 flex items-center gap-3">
            <label className="link-brand cursor-pointer text-xs">Load .csv file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
            </label>
            <button onClick={importCsv} disabled={busy || !csv.trim()} className="btn-primary ml-auto">{busy ? "Importing…" : "Import"}</button>
          </div>
        </div>
      )}

      {editingId && (
        <div className="card mb-4 p-4">
          <h2 className="mb-3 card-title">{editingId === "new" ? "New team" : "Edit team"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label><span className="label">Team ID</span><input className="field" value={draft.teamCode} onChange={(e) => setDraft({ ...draft, teamCode: e.target.value })} placeholder="e.g. TH-2026-001" /></label>
            <label><span className="label">Team name</span><input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Code Wizards" /></label>
            <label className="sm:col-span-2"><span className="label">GitHub repository URL</span><input className="field mono" value={draft.repoUrl} onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })} placeholder="https://github.com/team/project" inputMode="url" /></label>
            <label><span className="label">Project name <span className="text-ink-3">(optional)</span></span><input className="field" value={draft.projectTitle} onChange={(e) => setDraft({ ...draft, projectTitle: e.target.value })} placeholder="e.g. AI Health Tracker" /></label>
            <label><span className="label">Team leader / Members <span className="text-ink-3">(optional, comma-separated)</span></span><input className="field" value={draft.members} onChange={(e) => setDraft({ ...draft, members: e.target.value })} placeholder="e.g. Ali Khan, Sara Ahmed" /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save team"}</button>
            <button onClick={() => setEditingId(null)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {initialTeams.length === 0 ? (
        <EmptyState icon="teams" title="No teams have been added yet." description={locked ? undefined : "Add a team or import a CSV to get started."} action={locked ? undefined : <button onClick={startAdd} className="btn-primary"><Icon.plus size={16} /> Add team</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[0.7fr_1.2fr_1.8fr_0.5fr_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
            <span>Team ID</span><span>Team name</span><span>Repository</span><span>Members</span><span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            {initialTeams.map((t) => (
              <div key={t.id} className="grid grid-cols-1 gap-1 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[0.7fr_1.2fr_1.8fr_0.5fr_auto] sm:items-center sm:gap-4 sm:py-2.5">
                <div className="mono text-xs font-medium text-ink-2">{t.teamCode}</div>
                <div className="min-w-0">
                  <Link href={`/organizer/teams/${t.id}`} className="font-semibold text-ink hover:text-brand-text">{t.name}</Link>
                  {t.projectTitle && <div className="truncate text-xs text-ink-3">{t.projectTitle}</div>}
                </div>
                <div className="min-w-0">
                  {t.repoUrl ? (
                    <a href={t.repoUrl} target="_blank" className="mono flex items-center gap-1 truncate text-xs text-ink-2 hover:text-brand-text">
                      {repoShort(t.repoUrl)}<Icon.external size={11} />
                    </a>
                  ) : (
                    <span className="text-xs text-ink-3">No repo{!locked && <> — <button onClick={() => startEdit(t)} className="text-brand-text hover:underline">add URL</button></>}</span>
                  )}
                </div>
                <div className="text-sm text-ink-2">
                  <span className="nums font-medium text-ink">{t.memberNames.length}</span>
                  <span className="ml-1 text-xs text-ink-3 sm:hidden">member{t.memberNames.length === 1 ? "" : "s"}</span>
                </div>
                <div className="flex items-center gap-1 sm:justify-end">
                  {!locked && (
                    <>
                      <button onClick={() => startEdit(t)} className="rounded px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink" aria-label={`Edit ${t.teamCode}`}>Edit</button>
                      <button onClick={() => remove(t)} className="rounded px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-bad/10 hover:text-[var(--bad-text)]" aria-label={`Delete ${t.teamCode}`}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

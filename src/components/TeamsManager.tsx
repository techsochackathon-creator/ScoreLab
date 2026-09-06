"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/misc";
import { Icon } from "@/components/ui/icons";

export interface TeamRow {
  id: string;
  teamCode: string;
  name: string;
  university: string;
  track: string;
  memberNames: string[];
  projectTitle: string | null;
  technologies: string[];
}

type Draft = { teamCode: string; name: string; university: string; track: string; members: string; projectTitle: string; technologies: string };
const EMPTY: Draft = { teamCode: "", name: "", university: "", track: "", members: "", projectTitle: "", technologies: "" };

export function TeamsManager({ initialTeams }: { initialTeams: TeamRow[] }) {
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
    setDraft({ teamCode: t.teamCode, name: t.name, university: t.university, track: t.track, members: t.memberNames.join(", "), projectTitle: t.projectTitle ?? "", technologies: t.technologies.join(", ") });
  }

  async function save() {
    setBusy(true);
    const payload = {
      teamCode: draft.teamCode.trim(), name: draft.name.trim(), university: draft.university.trim(), track: draft.track.trim(),
      memberNames: draft.members.split(",").map((m) => m.trim()).filter(Boolean),
      projectTitle: draft.projectTitle.trim() || null,
      technologies: draft.technologies.split(",").map((m) => m.trim()).filter(Boolean),
    };
    const res = await fetch(editingId === "new" ? "/api/teams" : `/api/teams/${editingId}`, {
      method: editingId === "new" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) { toast(editingId === "new" ? "Team added" : "Team updated"); setEditingId(null); router.refresh(); }
    else { const d = await res.json().catch(() => ({})); toast(d.error ?? "Save failed", "error"); }
  }

  async function remove(t: TeamRow) {
    if (!confirm(`Delete "${t.name}" (${t.teamCode})? This also deletes its submissions.`)) return;
    const res = await fetch(`/api/teams/${t.id}`, { method: "DELETE" });
    if (res.ok) { toast("Team deleted"); router.refresh(); } else toast("Delete failed", "error");
  }

  async function importCsv() {
    setBusy(true);
    const res = await fetch("/api/teams/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { toast(`Imported ${d.created} new, ${d.updated} updated`); setCsv(""); setShowCsv(false); router.refresh(); }
    else toast(d.error ?? "Import failed", "error");
  }

  return (
    <div className="fade-in-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Teams</h1>
          <p className="mt-1 text-sm text-ink-2">Manage participating teams, or bulk-import from CSV.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCsv((v) => !v)} className="btn-ghost">Import CSV</button>
          <button onClick={startAdd} className="btn-primary"><Icon.plus size={16} /> Add team</button>
        </div>
      </header>

      {showCsv && (
        <div className="card mb-4 p-4">
          <p className="mb-2 text-xs text-ink-3">Header row required. Columns: <span className="mono text-ink-2">teamCode, name, university, track, members</span>. Members separated by <span className="mono">;</span> or <span className="mono">|</span>. Existing codes update.</p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} placeholder={"teamCode,name,university,track,members\nT01,Rockets,State University,Web,Ada; Alan"} className="field mono text-xs" />
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
          <h2 className="mb-3 text-sm font-semibold text-ink">{editingId === "new" ? "New team" : "Edit team"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label><span className="label">Team code</span><input className="field" value={draft.teamCode} onChange={(e) => setDraft({ ...draft, teamCode: e.target.value })} /></label>
            <label><span className="label">Name</span><input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label><span className="label">University</span><input className="field" value={draft.university} onChange={(e) => setDraft({ ...draft, university: e.target.value })} /></label>
            <label><span className="label">Track</span><input className="field" value={draft.track} onChange={(e) => setDraft({ ...draft, track: e.target.value })} /></label>
            <label className="sm:col-span-2"><span className="label">Members (comma-separated)</span><input className="field" value={draft.members} onChange={(e) => setDraft({ ...draft, members: e.target.value })} /></label>
            <label><span className="label">Project title <span className="text-ink-3">(optional)</span></span><input className="field" value={draft.projectTitle} onChange={(e) => setDraft({ ...draft, projectTitle: e.target.value })} /></label>
            <label><span className="label">Technologies <span className="text-ink-3">(comma-separated)</span></span><input className="field" value={draft.technologies} onChange={(e) => setDraft({ ...draft, technologies: e.target.value })} /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save team"}</button>
            <button onClick={() => setEditingId(null)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {initialTeams.length === 0 ? (
        <EmptyState icon="teams" title="No teams yet" description="Add a team or import a CSV to get started." action={<button onClick={startAdd} className="btn-primary"><Icon.plus size={16} /> Add team</button>} />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[0.7fr_1.4fr_1.2fr_0.7fr_auto] gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-ink-3 sm:grid">
            <span>Team ID</span><span>Team</span><span>University</span><span>Members</span><span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            {initialTeams.map((t) => (
              <div key={t.id} className="grid grid-cols-1 gap-1 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[0.7fr_1.4fr_1.2fr_0.7fr_auto] sm:items-center sm:gap-4">
                <div className="mono text-xs text-ink-3">{t.teamCode}</div>
                <div className="min-w-0">
                  <Link href={`/organizer/teams/${t.id}`} className="font-semibold text-ink hover:text-brand">{t.name}</Link>
                </div>
                <div className="text-sm text-ink-2">{t.university}</div>
                <div className="text-sm text-ink-2">
                  <span className="nums font-medium text-ink">{t.memberNames.length}</span>
                  <span className="text-ink-3"> member{t.memberNames.length === 1 ? "" : "s"}</span>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <button onClick={() => startEdit(t)} className="text-xs font-medium text-ink-2 hover:text-ink">Edit</button>
                  <button onClick={() => remove(t)} className="text-xs font-medium text-ink-2 hover:text-bad">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

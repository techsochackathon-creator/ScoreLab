"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { EvaluationProgress, EvaluationStatus } from "@/lib/judgeEvaluations";
import { friendlyApiError } from "@/lib/uiErrors";

export interface JudgeRow {
  id: string;
  name: string | null;
  email: string;
  active: boolean;
  createdAt: string;
  teamIds: string[];
  /** This judge's evaluation status for each assigned team. */
  statusByTeam: Record<string, EvaluationStatus>;
  progress: EvaluationProgress;
}

export interface TeamOption {
  id: string;
  teamCode: string;
  name: string;
  /** How many judges this team is assigned to. */
  judgeCount: number;
}

const EVAL_PILL: Record<EvaluationStatus, { label: string; pill: string }> = {
  NOT_STARTED: { label: "Not started", pill: "status-queued" },
  DRAFT: { label: "Draft", pill: "status-review" },
  SUBMITTED: { label: "Submitted", pill: "status-completed" },
};

function EvalPill({ status }: { status: EvaluationStatus }) {
  const p = EVAL_PILL[status];
  return (
    <span className={`status-pill ${p.pill}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {p.label}
    </span>
  );
}

type NewJudge = { name: string; email: string; password: string };
const EMPTY: NewJudge = { name: "", email: "", password: "" };

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { ok: false, error: "Network error. Check your connection and try again." };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: friendlyApiError(res.status, data.error as string | undefined, "Request failed") };
}

/** `children`: the server-rendered overall judging-progress panel, shown under the header. */
export function JudgesManager({ judges, teams, finalized, children }: { judges: JudgeRow[]; teams: TeamOption[]; finalized: boolean; children?: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewJudge>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(judges[0]?.id ?? null);

  const selected = judges.find((j) => j.id === selectedId) ?? null;

  async function create() {
    setBusy(true);
    const r = await send("/api/judges", "POST", {
      name: draft.name.trim(),
      email: draft.email.trim(),
      password: draft.password,
    });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Judge created");
    setDraft(EMPTY);
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="fade-in-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Judges</h1>
          <p className="mt-1 text-sm text-ink-2">
            Create judge accounts and choose which teams each judge can see.
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="btn-primary">
          <Icon.plus size={16} /> Add judge
        </button>
      </header>

      {children}

      {adding && (
        <div className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">New judge</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label><span className="label">Name</span><input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Dr. Ayesha Malik" /></label>
            <label><span className="label">Email (login)</span><input className="field" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="judge@example.com" autoComplete="off" /></label>
            <label><span className="label">Temporary password</span><input className="field" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="At least 8 characters" autoComplete="new-password" /></label>
          </div>
          <p className="mt-2 text-xs text-ink-3">Share the password with the judge yourself — it is stored hashed and can&apos;t be shown again.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={create} disabled={busy} className="btn-primary">{busy ? "Creating…" : "Create judge"}</button>
            <button onClick={() => { setAdding(false); setDraft(EMPTY); }} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {judges.length === 0 ? (
        <EmptyState icon="judges" title="No judges yet" description="Add a judge account, then assign the teams they should evaluate." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="card overflow-hidden self-start">
            <div className="divide-y divide-[var(--glass-border)]">
              {judges.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelectedId(j.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  style={j.id === selectedId ? { background: "var(--surface-2)" } : undefined}
                  aria-current={j.id === selectedId}
                >
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-semibold ${j.active ? "text-ink" : "text-ink-3"}`}>{j.name || j.email}</div>
                    <div className="truncate text-xs text-ink-3">{j.email}</div>
                  </div>
                  <ActivePill active={j.active} />
                  <div className="w-28 shrink-0 text-right">
                    <div className="nums text-xs text-ink-2">
                      <span className="font-semibold text-ink">{j.progress.submitted}</span>/{j.progress.assigned} submitted
                      <span className="ml-1 text-ink-3">{j.progress.percent}%</span>
                    </div>
                    <ProgressBar value={j.progress.percent} height={4} className="mt-1" label={`${j.name || j.email}: evaluations submitted`} />
                    <div className="mt-0.5 text-[10px] text-ink-3">
                      {j.progress.draft} draft · {j.progress.notStarted} not started
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selected && <JudgeDetail key={selected.id} judge={selected} teams={teams} finalized={finalized} />}
        </div>
      )}
    </div>
  );
}

function ActivePill({ active }: { active: boolean }) {
  return (
    <span className={`status-pill ${active ? "status-completed" : "status-failed"}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {active ? "Active" : "Disabled"}
    </span>
  );
}

function JudgeDetail({ judge, teams, finalized }: { judge: JudgeRow; teams: TeamOption[]; finalized: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(judge.name ?? "");
  const [email, setEmail] = useState(judge.email);
  const [password, setPassword] = useState("");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const assigned = judge.teamIds
    .map((id) => teamById.get(id))
    .filter((t): t is TeamOption => !!t)
    .sort((a, b) => a.teamCode.localeCompare(b.teamCode));
  const assignedSet = new Set(judge.teamIds);
  const q = filter.trim().toLowerCase();
  const available = teams.filter(
    (t) => !assignedSet.has(t.id) && (!q || t.teamCode.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)),
  );

  async function run(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    const r = await send(url, method, body);
    setBusy(false);
    if (!r.ok) { toast(r.error, "error"); return false; }
    toast(done);
    router.refresh();
    return true;
  }

  const base = `/api/judges/${judge.id}`;
  const detailsChanged = name.trim() !== (judge.name ?? "") || email.trim().toLowerCase() !== judge.email;

  function saveDetails() {
    const body: Record<string, string> = {};
    if (name.trim() !== (judge.name ?? "")) body.name = name.trim();
    if (email.trim().toLowerCase() !== judge.email) body.email = email.trim();
    return run(base, "PATCH", body, "Judge updated");
  }

  async function resetPassword() {
    if (await run(base, "PATCH", { password }, "Password reset")) setPassword("");
  }

  function toggleActive() {
    if (judge.active && !confirm(`Disable ${judge.name || judge.email}? They will be signed out of judge pages and unable to log in. Assignments are kept.`)) return;
    return run(base, "PATCH", { active: !judge.active }, judge.active ? "Judge disabled" : "Judge enabled");
  }

  async function assign() {
    if (await run(`${base}/assignments`, "POST", { teamIds: [...picked] }, `Assigned ${picked.size} team${picked.size === 1 ? "" : "s"}`)) {
      setPicked(new Set());
    }
  }

  function unassign(t: TeamOption) {
    if (!confirm(`Remove ${t.teamCode} (${t.name}) from ${judge.name || judge.email}?

The judge will no longer see this team. This is only possible because they have not started evaluating it.`)) return;
    return run(`${base}/assignments?teamId=${encodeURIComponent(t.id)}`, "DELETE", undefined, `Removed ${t.teamCode}`);
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <SectionTitle right={<ActivePill active={judge.active} />}>Judge details</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label><span className="label">Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span className="label">Email (login)</span><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={saveDetails} disabled={busy || !detailsChanged} className="btn-primary">Save details</button>
          <button onClick={toggleActive} disabled={busy} className="btn-ghost">{judge.active ? "Disable judge" : "Enable judge"}</button>
          <span className="ml-auto text-xs text-ink-3">
            Created {new Date(judge.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>

        <div className="section-divider my-4" />
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="label">Reset password</span>
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (min 8 characters)" autoComplete="new-password" />
          </label>
          <button onClick={resetPassword} disabled={busy || password.length === 0} className="btn-ghost">Reset</button>
        </div>
      </section>

      <section className="card p-5">
        <SectionTitle right={
          <span className="nums text-xs text-ink-2">
            {assigned.length} assigned · {judge.progress.submitted} submitted · {judge.progress.draft} draft · {judge.progress.notStarted} not started
          </span>
        }>Assigned teams</SectionTitle>
        {finalized && (
          <p className="mb-2 text-xs" style={{ color: "var(--warn)" }}>Judging is finalized — assignments can no longer be changed.</p>
        )}
        {assigned.length === 0 ? (
          <p className="py-3 text-sm text-ink-3">No teams assigned yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--glass-border)]">
            {assigned.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                <EvalPill status={judge.statusByTeam[t.id] ?? "NOT_STARTED"} />
                {!finalized && (judge.statusByTeam[t.id] ?? "NOT_STARTED") === "NOT_STARTED" ? (
                  <button onClick={() => unassign(t)} disabled={busy} className="text-xs font-medium text-ink-2 hover:text-bad">Remove</button>
                ) : !finalized ? (
                  <span className="text-[11px] text-ink-3" title="The judge has started this evaluation, so the assignment is kept.">Kept</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <SectionTitle>Add teams</SectionTitle>
        {finalized ? (
          <p className="text-sm text-ink-3">Judging is finalized.</p>
        ) : teams.length === assigned.length ? (
          <p className="text-sm text-ink-3">{teams.length === 0 ? "No teams exist yet." : "Every team is already assigned to this judge."}</p>
        ) : (
          <>
            <input className="field mb-2" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by team ID or name" />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--glass-border)]">
              {available.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-3">No matching teams.</p>
              ) : (
                available.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => togglePick(t.id)} />
                    <span className="mono w-28 shrink-0 text-xs text-ink-3">{t.teamCode}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                    <span className={`nums shrink-0 text-xs ${t.judgeCount === 0 ? "font-semibold" : "text-ink-3"}`} style={t.judgeCount === 0 ? { color: "var(--warn)" } : undefined}>
                      {t.judgeCount === 0 ? "no judges yet" : `${t.judgeCount} judge${t.judgeCount === 1 ? "" : "s"}`}
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={assign} disabled={busy || picked.size === 0} className="btn-primary">
                Assign {picked.size || ""} team{picked.size === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

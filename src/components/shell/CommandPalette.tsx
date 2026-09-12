"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [teams, setTeams] = useState<{ id: string; name: string; teamCode: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      inputRef.current?.focus();
      fetch("/api/teams")
        .then((r) => (r.ok ? r.json() : { teams: [] }))
        .then((d) => setTeams(d.teams ?? []))
        .catch(() => {});
    }
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const commands: Cmd[] = useMemo(
    () => [
      { id: "overview", label: "Go to Overview", icon: "overview", run: () => go("/organizer/dashboard") },
      { id: "teams", label: "Go to Teams", icon: "teams", run: () => go("/organizer/teams") },
      { id: "evaluate", label: "Start an evaluation", icon: "evaluations", run: () => go("/organizer/evaluations") },
      { id: "batch", label: "Run batch evaluation", icon: "spark", run: () => go("/organizer/batch") },
      { id: "runs", label: "Manage evaluation runs", icon: "runs", run: () => go("/organizer/runs") },
      { id: "rubric", label: "Edit rubric", icon: "rubric", run: () => go("/organizer/rubric") },
      { id: "leaderboard", label: "Open leaderboard", icon: "leaderboard", run: () => go("/leaderboard") },
      { id: "analytics", label: "Open analytics", icon: "analytics", run: () => go("/organizer/analytics") },
      { id: "integrity", label: "Open integrity", icon: "integrity", run: () => go("/organizer/integrity") },
      { id: "settings", label: "Open settings", icon: "settings", run: () => go("/organizer/settings") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const teamCmds: Cmd[] = teams.map((t) => ({
    id: `team-${t.id}`,
    label: t.name,
    hint: t.teamCode,
    icon: "teams",
    run: () => go(`/organizer/teams/${t.id}`),
  }));

  const all = [...commands, ...teamCmds];
  const filtered = q.trim()
    ? all.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(q.toLowerCase()))
    : all.slice(0, 10);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl fade-in-up"
        style={{
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4">
          <span className="text-ink-3"><Icon.search size={16} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search teams, evaluations, or anything…"
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="mono hidden rounded border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px] text-ink-3 sm:block">esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-ink-3">No matches</div>
          ) : (
            filtered.map((c, i) => {
              const I = Icon[c.icon];
              return (
                <button
                  key={c.id}
                  onClick={c.run}
                  onMouseEnter={() => setActive(i)}
                  data-active={i === active}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors data-[active=true]:bg-[var(--surface-2)]"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3" style={i === active ? { background: "var(--brand-tint)", color: "var(--brand)" } : {}}>
                    <I size={15} />
                  </span>
                  <span className="text-ink">{c.label}</span>
                  {c.hint && <span className="mono ml-auto text-xs text-ink-3">{c.hint}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import { CommandPalette } from "@/components/shell/CommandPalette";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

/** Grouped by job: run the event, judge it, then the AI reference tooling. */
const NAV: { label?: string; items: NavItem[] }[] = [
  { items: [{ href: "/organizer/dashboard", label: "Overview", icon: "overview" }] },
  {
    label: "Manage",
    items: [
      { href: "/organizer/teams", label: "Teams", icon: "teams" },
      { href: "/organizer/judges", label: "Judges", icon: "judges" },
      { href: "/organizer/rubric", label: "Rubric", icon: "rubric" },
    ],
  },
  {
    label: "Results",
    items: [
      { href: "/organizer/results", label: "Results", icon: "integrity" },
      { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
    ],
  },
  {
    label: "AI evaluation",
    items: [
      { href: "/organizer/evaluations", label: "Evaluations", icon: "evaluations" },
      { href: "/organizer/batch", label: "Batch", icon: "spark" },
      { href: "/organizer/analytics", label: "Analytics", icon: "analytics" },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav aria-label="Organizer" className="flex flex-col">
      {NAV.map((group, gi) => (
        <div key={group.label ?? gi} role="group" aria-label={group.label}>
          {group.label && <div className="nav-group-label">{group.label}</div>}
          <div className="flex flex-col gap-0.5">
            {group.items.map((n) => {
              const I = Icon[n.icon];
              const active = isActive(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className="nav-item"
                >
                  <span className="nav-icon"><I size={16} /></span>
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** AI engine status line at the bottom of the sidebar. */
function AiStatusCard() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <Icon.spark size={14} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-ink-3" title="Gemini-powered evaluation engine">AI engine · Gemini</span>
      <span className="flex shrink-0 items-center gap-1.5 font-medium" style={{ color: "var(--good-text)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--good)" }} />
        Active
      </span>
    </div>
  );
}

function SidebarFooter({ pathname, email, onNavigate }: { pathname: string; email?: string | null; onNavigate?: () => void }) {
  const settingsActive = pathname.startsWith("/organizer/settings");
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-hair pt-2">
      <AiStatusCard />
      <Link
        href="/organizer/settings"
        onClick={onNavigate}
        data-active={settingsActive}
        aria-current={settingsActive ? "page" : undefined}
        className="nav-item"
      >
        <span className="nav-icon"><Icon.settings size={16} /></span>
        Settings
      </Link>
      <SignOutButton full />
      <div className="mt-1 flex items-center gap-2.5 border-t border-hair px-3 pb-1 pt-3">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
          style={{ background: "var(--surface-2)", color: "var(--ink-2)", border: "1px solid var(--hair-strong)" }}
        >
          {(email ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink-2">{email ?? "Organizer"}</span>
          <span className="block text-[11px] text-ink-3">Organizer</span>
        </span>
      </div>
    </div>
  );
}

export function Shell({ children, email }: { children: React.ReactNode; email?: string | null }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <CommandPalette />

      {/* ── Desktop sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hair bg-sidebar px-3 pb-3 lg:flex">
        <div className="flex h-14 shrink-0 items-center px-2">
          <Link href="/organizer/dashboard" aria-label="ScoreLab — overview"><Logo /></Link>
        </div>
        <div className="flex-1 overflow-y-auto pt-1">
          <NavLinks pathname={pathname} />
        </div>
        <SidebarFooter pathname={pathname} email={email} />
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-hair bg-sidebar px-3 lg:hidden">
        <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="grid h-9 w-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
          <Icon.menu size={18} />
        </button>
        <Link href="/organizer/dashboard" aria-label="ScoreLab — overview"><Logo /></Link>
        <ThemeToggle />
      </header>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-hair bg-sidebar px-3 pb-3 slide-in-left">
            <div className="flex h-14 shrink-0 items-center justify-between px-2">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                <Icon.close size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pt-1">
              <NavLinks pathname={pathname} onNavigate={() => setDrawer(false)} />
            </div>
            <SidebarFooter pathname={pathname} email={email} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="lg:pl-60">
        {/* Desktop top bar */}
        <div className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-4 border-b border-hair bg-bg px-6 lg:flex">
          <CommandTrigger />
          <ThemeToggle />
        </div>
        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}

function CommandTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-hair-strong bg-surface px-3 text-[13px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
    >
      <Icon.search size={14} className="shrink-0" />
      <span className="truncate">Search teams, evaluations…</span>
      <kbd className="mono ml-auto shrink-0 rounded border border-hair-strong px-1.5 py-0.5 text-[10px] text-ink-3">⌘K</kbd>
    </button>
  );
}

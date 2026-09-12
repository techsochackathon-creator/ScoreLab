"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import { CommandPalette } from "@/components/shell/CommandPalette";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { href: "/organizer/dashboard", label: "Overview", icon: "overview" },
  { href: "/organizer/teams", label: "Teams", icon: "teams" },
  { href: "/organizer/evaluations", label: "Evaluations", icon: "evaluations" },
  { href: "/organizer/batch", label: "Batch", icon: "spark" },
  { href: "/organizer/runs", label: "Runs", icon: "runs" },
  { href: "/organizer/rubric", label: "Rubric", icon: "rubric" },
  { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
  { href: "/organizer/analytics", label: "Analytics", icon: "analytics" },
  { href: "/organizer/integrity", label: "Integrity", icon: "integrity" },
];

function Logo() {
  return (
    <Link href="/organizer/dashboard" className="flex items-center gap-2.5 px-1 group">
      <span
        className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-extrabold transition-shadow"
        style={{ background: "var(--gradient-brand)", color: "var(--brand-fg)", boxShadow: "var(--glow-brand-sm)" }}
      >
        S
      </span>
      <span className="text-[15px] font-bold tracking-tight text-ink">
        Score<span style={{ color: "var(--brand)" }}>Lab</span>
      </span>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => {
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
    </nav>
  );
}

/** AI platform status card at bottom of sidebar. */
function AiStatusCard() {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--glass-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{ background: "var(--brand-tint)" }}
        >
          <Icon.spark size={12} style={{ color: "var(--brand)" }} />
        </span>
        <span className="text-xs font-semibold text-ink">AI Engine</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] font-medium" style={{ color: "var(--good)" }}>
          <span className="h-1.5 w-1.5 rounded-full pulse-glow" style={{ background: "var(--good)" }} />
          Active
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
        Gemini-powered evaluation engine
      </p>
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
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col px-3 py-4 lg:flex"
        style={{
          background: "var(--glass-bg)",
          borderRight: "1px solid var(--glass-border)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          backgroundImage: "var(--gradient-sidebar)",
        }}
      >
        <div className="h-8 slide-in-left"><Logo /></div>

        <div className="mt-6 flex-1 overflow-y-auto">
          <NavLinks pathname={pathname} />
        </div>

        <div className="mt-2 flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
          <AiStatusCard />
          <Link href="/organizer/settings" data-active={pathname.startsWith("/organizer/settings")} className="nav-item">
            <span className="nav-icon"><Icon.settings size={16} /></span>
            Settings
          </Link>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
              style={{ background: "var(--brand-tint)", color: "var(--brand)" }}
            >
              {(email ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{email ?? "Organizer"}</span>
          </div>
          <SignOutButton full />
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between px-4 lg:hidden"
        style={{
          background: "var(--glass-bg)",
          borderBottom: "1px solid var(--glass-border)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <button onClick={() => setDrawer(true)} aria-label="Open menu" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:text-ink transition-colors">
          <Icon.menu size={18} />
        </button>
        <Logo />
        <ThemeToggle />
      </header>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] px-3 py-4 slide-in-left"
            style={{
              background: "var(--glass-bg)",
              borderRight: "1px solid var(--glass-border)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <div className="flex items-center justify-between px-1">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:text-ink transition-colors">
                <Icon.close size={18} />
              </button>
            </div>
            <div className="mt-6">
              <NavLinks pathname={pathname} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
              <AiStatusCard />
              <Link href="/organizer/settings" onClick={() => setDrawer(false)} className="nav-item">
                <span className="nav-icon"><Icon.settings size={16} /></span>Settings
              </Link>
              <SignOutButton full />
            </div>
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="lg:pl-60">
        {/* Desktop top bar */}
        <div
          className="sticky top-0 z-30 hidden h-14 items-center justify-between px-6 lg:flex"
          style={{
            background: "var(--glass-bg)",
            borderBottom: "1px solid var(--glass-border)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <CommandTrigger />
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function CommandTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-ink-3 transition-all hover:text-ink-2"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--glass-border)",
      }}
    >
      <Icon.search size={14} />
      <span>Search teams, evaluations, or anything…</span>
      <kbd className="mono ml-4 rounded border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px] text-ink-3">⌘K</kbd>
    </button>
  );
}

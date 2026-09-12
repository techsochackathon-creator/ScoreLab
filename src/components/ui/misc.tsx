import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

/* ================================================================
   Accent color per icon type — varied colors for different metrics
   ================================================================ */
const ICON_ACCENTS: Record<string, { bg: string; fg: string }> = {
  teams:       { bg: "rgba(56, 189, 248, 0.12)", fg: "var(--info)" },
  check:       { bg: "rgba(16, 185, 129, 0.12)", fg: "var(--good)" },
  analytics:   { bg: "rgba(167, 139, 250, 0.12)", fg: "var(--purple)" },
  leaderboard: { bg: "rgba(251, 191, 36, 0.12)", fg: "var(--warn)" },
  evaluations: { bg: "rgba(34, 211, 238, 0.12)", fg: "var(--cyan)" },
  integrity:   { bg: "rgba(16, 185, 129, 0.12)", fg: "var(--good)" },
  spark:       { bg: "rgba(167, 139, 250, 0.12)", fg: "var(--purple)" },
  runs:        { bg: "rgba(56, 189, 248, 0.12)", fg: "var(--info)" },
};

/** Premium stat card with icon, value, and optional footnote. */
export function StatCard({
  label,
  value,
  icon,
  foot,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  foot?: ReactNode;
  accent?: boolean;
}) {
  const I = Icon[icon];
  const colors = ICON_ACCENTS[icon] ?? (accent
    ? { bg: "var(--brand-tint)", fg: "var(--brand)" }
    : { bg: "var(--surface-2)", fg: "var(--ink-3)" });

  return (
    <div className="card p-5 transition-all hover:border-[var(--hair-strong)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-3 uppercase tracking-wider">{label}</span>
        <span
          className="grid h-9 w-9 place-items-center rounded-lg"
          style={{ background: colors.bg, color: colors.fg }}
        >
          <I size={17} />
        </span>
      </div>
      <div className="mt-3 stat-value">{value}</div>
      {foot && <div className="mt-2 text-xs text-ink-3">{foot}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    PENDING: "status-queued",
    EVALUATING: "status-evaluating",
    EVALUATED: "status-completed",
    FAILED: "status-failed",
    REVIEW_REQUIRED: "status-review",
    COMPLETED: "status-completed",
    RUNNING: "status-evaluating",
    QUEUED: "status-queued",
    CANCELLED: "status-queued",
    PAUSED: "status-review",
  };
  const cls = classMap[status] ?? "status-queued";
  const label = status === "REVIEW_REQUIRED" ? "Review" : status.charAt(0) + status.slice(1).toLowerCase();
  const pulse = status === "EVALUATING" || status === "RUNNING";

  return (
    <span className={`status-pill ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${pulse ? "pulse-glow" : ""}`} style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}

export function EmptyState({
  icon = "spark",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const I = Icon[icon];
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <span
        className="grid h-14 w-14 place-items-center rounded-xl"
        style={{ background: "var(--surface-2)", border: "1px solid var(--glass-border)" }}
      >
        <I size={22} style={{ color: "var(--ink-3)" }} />
      </span>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer ${className}`} style={{ minHeight: 20 }} />;
}

/** Page section heading with optional right-side action. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3">{children}</h2>
      {right}
    </div>
  );
}

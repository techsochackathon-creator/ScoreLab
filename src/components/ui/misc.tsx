import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

/** Compact stat tile: label, value, optional footnote. `accent` marks the one tile worth the eye. */
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
  return (
    <div className="card h-full p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="section-title truncate">{label}</span>
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
          style={accent
            ? { background: "var(--brand-tint)", color: "var(--brand-text)" }
            : { background: "var(--surface-2)", color: "var(--ink-3)" }}
        >
          <I size={15} />
        </span>
      </div>
      <div className="mt-3 stat-value">{value}</div>
      {foot && <div className="mt-1.5 text-xs text-ink-3">{foot}</div>}
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
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <span
        className="grid h-11 w-11 place-items-center rounded-lg"
        style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}
      >
        <I size={20} style={{ color: "var(--ink-3)" }} />
      </span>
      <h3 className="mt-3 card-title">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer ${className}`} style={{ minHeight: 20 }} />;
}

/** Page section heading with optional right-side action. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="section-title">{children}</h2>
      {right}
    </div>
  );
}

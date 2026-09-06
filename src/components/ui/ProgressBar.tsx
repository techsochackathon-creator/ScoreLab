/** Thin progress/score bar. `tone` picks the fill color. */
export function ProgressBar({
  value,
  max = 100,
  color = "var(--brand)",
  className = "",
  height = 6,
}: {
  value: number | null;
  max?: number;
  color?: string;
  className?: string;
  height?: number;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={value ?? 0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color, transition: "width 700ms cubic-bezier(0.22,1,0.36,1)" }}
      />
    </div>
  );
}

/** CSS var for a 1..scaleMax score mapped onto the 5-step band ramp. */
export function bandVar(score: number, scaleMax: number): string {
  const n = scaleMax <= 1 ? 5 : Math.round(1 + ((score - 1) / (scaleMax - 1)) * 4);
  return `var(--s${Math.max(1, Math.min(5, n))})`;
}

/** CSS var for a 0..100 total mapped onto the band ramp. */
export function totalBandVar(total: number): string {
  const n = Math.round(1 + (Math.max(0, Math.min(100, total)) / 100) * 4);
  return `var(--s${Math.max(1, Math.min(5, n))})`;
}

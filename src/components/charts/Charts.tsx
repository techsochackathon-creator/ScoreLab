"use client";

/**
 * Lightweight, dependency-free SVG charts. All derive from real data passed in.
 * Premium dark AI aesthetic with animated bars and gradient fills.
 */

/** Vertical bar histogram (score distribution). */
export function Histogram({ bins, labels, height = 180 }: { bins: number[]; labels: string[]; height?: number }) {
  const maxV = Math.max(1, ...bins);
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {bins.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-2">
          <span className="nums text-[10px] font-medium text-ink-3">{v > 0 ? v : ""}</span>
          <div className="flex w-full items-end justify-center" style={{ height: height - 44 }}>
            <div
              className="w-full max-w-[36px] rounded-t-md transition-all duration-700"
              style={{
                height: `${(v / maxV) * 100}%`,
                minHeight: v > 0 ? 4 : 0,
                background: "linear-gradient(180deg, var(--brand), rgba(16, 185, 129, 0.3))",
                boxShadow: v > 0 ? "0 0 8px rgba(16, 185, 129, 0.15)" : "none",
                animationDelay: `${i * 60}ms`,
              }}
            />
          </div>
          <span className="text-[10px] text-ink-3">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal labeled bars (per-criterion averages, etc.). */
export function BarList({ items, max = 100, unit = "" }: { items: { label: string; value: number; color?: string }[]; max?: number; unit?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-ink-2">{it.label}</span>
            <span className="nums font-semibold text-ink">
              {it.value.toFixed(1)}
              {unit}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (it.value / max) * 100)}%`,
                background: it.color ? `linear-gradient(90deg, ${it.color}, ${it.color}88)` : "linear-gradient(90deg, var(--brand), var(--brand)88)",
                transition: "width 700ms cubic-bezier(0.22,1,0.36,1)",
                boxShadow: `0 0 6px ${it.color ?? "var(--brand)"}30`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Radar chart for one entity across N axes (0..max each). */
export function RadarChart({
  axes,
  values,
  max = 5,
  size = 260,
}: {
  axes: string[];
  values: number[];
  max?: number;
  size?: number;
}) {
  const n = axes.length;
  if (n < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 34;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, r: number) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const rings = [0.25, 0.5, 0.75, 1];
  const gridPath = (ratio: number) =>
    axes.map((_, i) => point(i, R * ratio).join(",")).join(" ");
  const dataPath = values.map((v, i) => point(i, R * (Math.max(0, Math.min(max, v)) / max)).join(",")).join(" ");

  return (
    <svg width={size} height={size} className="mx-auto">
      {rings.map((r) => (
        <polygon key={r} points={gridPath(r)} fill="none" stroke="var(--hair)" strokeWidth={0.5} strokeDasharray={r < 1 ? "2,3" : "0"} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--hair)" strokeWidth={0.5} />;
      })}
      <polygon points={dataPath} fill="rgba(16, 185, 129, 0.08)" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = point(i, R * (Math.max(0, Math.min(max, v)) / max));
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={5} fill="var(--brand)" fillOpacity={0.15} />
            <circle cx={x} cy={y} r={3} fill="var(--brand)" />
          </g>
        );
      })}
      {axes.map((a, i) => {
        const [x, y] = point(i, R + 18);
        return (
          <text key={a} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-sans)">
            {a.length > 14 ? a.slice(0, 13) + "…" : a}
          </text>
        );
      })}
    </svg>
  );
}

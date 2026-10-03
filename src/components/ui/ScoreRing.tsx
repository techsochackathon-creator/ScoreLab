"use client";

import { useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/ui/CountUp";

/**
 * Circular score indicator with glow effect. `value` out of `max`. Animates the arc on mount.
 */
export function ScoreRing({
  value,
  max = 100,
  size = 132,
  stroke = 10,
  label,
  decimals = 1,
  color = "var(--brand)",
}: {
  value: number | null;
  max?: number;
  size?: number;
  stroke?: number;
  label?: string;
  decimals?: number;
  color?: string;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [dash, setDash] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      setDash(pct * c);
      return;
    }
    started.current = true;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setDash(pct * c);
    const id = requestAnimationFrame(() => setDash(pct * c));
    return () => cancelAnimationFrame(id);
  }, [pct, c]);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <filter id="ring-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2-solid)"
          strokeWidth={stroke}
        />
        {/* Value arc with glow */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - dash}
          filter="url(#ring-glow)"
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        {value == null ? (
          <span className="nums text-2xl font-extrabold text-ink-3">—</span>
        ) : (
          <span className="nums text-[28px] font-extrabold leading-none tracking-tight text-ink">
            <CountUp value={value} decimals={decimals} />
          </span>
        )}
        {label && <span className="mt-1 text-[11px] font-medium text-ink-3">{label}</span>}
      </div>
    </div>
  );
}

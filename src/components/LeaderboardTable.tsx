"use client";

import { useMemo, useState } from "react";
import { CountUp } from "@/components/ui/CountUp";
import { ProgressBar, totalBandVar } from "@/components/ui/ProgressBar";
import { Icon } from "@/components/ui/icons";

export interface LeaderRow {
  teamId: string;
  teamName: string;
  university: string;
  track: string;
  totalScore: number;
  trend: number | null;
  /** Pre-computed rank from finalized snapshot (unique after tie resolution). */
  rank?: number;
  /** How the tie was resolved (null if no tie). */
  tieBreakMethod?: string | null;
}

const MEDAL = ["var(--gold)", "var(--silver)", "var(--bronze)"];

function Trend({ v }: { v: number | null }) {
  if (v == null) return <span className="chip text-[11px]">new</span>;
  if (Math.abs(v) < 0.05) return <span className="inline-flex items-center gap-1 text-xs text-ink-3"><Icon.trendFlat size={13} />0.0</span>;
  const up = v > 0;
  return (
    <span className="nums inline-flex items-center gap-1 text-xs font-semibold" style={{ color: up ? "var(--good)" : "var(--bad)" }}>
      {up ? <Icon.trendUp size={13} /> : <Icon.trendDown size={13} />}{up ? "+" : ""}{v.toFixed(1)}
    </span>
  );
}

export function LeaderboardTable({ rows, tracks }: { rows: LeaderRow[]; tracks: string[] }) {
  const [track, setTrack] = useState("all");
  const ranked = useMemo(() => {
    const list = track === "all" ? rows : rows.filter((r) => r.track === track);
    // If rows carry pre-computed ranks (from finalized snapshot), use them;
    // otherwise fall back to positional ranking.
    if (track === "all" && list.length > 0 && list[0].rank != null) {
      return list.map((r) => ({ ...r, rank: r.rank! }));
    }
    return list.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, track]);

  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {["all", ...tracks].map((t) => {
          const active = t === track;
          return (
            <button key={t} onClick={() => setTrack(t)} aria-pressed={active}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${active ? "text-[var(--brand-fg)]" : "text-ink-2 hover:text-ink"}`}
              style={active
                ? { background: "var(--gradient-brand)", boxShadow: "var(--glow-brand-sm)" }
                : { background: "var(--surface-2)", border: "1px solid var(--glass-border)" }
              }>
              {t === "all" ? "All tracks" : t}
            </button>
          );
        })}
      </div>

      {podium.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {podium.map((r, i) => (
            <div
              key={r.teamId}
              className={`card p-5 transition-all ${r.rank === 1 ? "sm:-mt-2 sm:pb-7" : ""}`}
              style={{
                borderTop: `2px solid ${MEDAL[i]}`,
                boxShadow: r.rank === 1 ? `0 0 20px ${MEDAL[0]}20` : undefined,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="mono grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
                  style={{ background: MEDAL[i], boxShadow: r.rank === 1 ? `0 0 12px ${MEDAL[0]}40` : undefined }}
                >
                  {r.rank}
                </span>
                <Trend v={r.trend} />
              </div>
              <div className="mt-3 truncate text-base font-semibold text-ink">{r.teamName}</div>
              <div className="truncate text-xs text-ink-3">{r.university}</div>
              {r.tieBreakMethod && (
                <div className="mt-1 text-[10px] text-ink-3" title="Rank determined by tie-break resolution">⚡ Tie resolved</div>
              )}
              <div className="mt-3 flex items-baseline gap-1">
                <span className="nums text-3xl font-extrabold tracking-tight text-ink"><CountUp value={r.totalScore} /></span>
                <span className="text-sm font-medium text-ink-3">/100</span>
              </div>
              <ProgressBar value={r.totalScore} color={totalBandVar(r.totalScore)} className="mt-2" />
            </div>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[var(--glass-border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-3 sm:grid">
            <span className="w-7 text-center">#</span><span>Team</span><span className="w-16 text-right">Score</span><span className="w-16 text-right">Trend</span>
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            {rest.map((r) => (
              <div key={r.teamId} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--surface-2)] sm:grid-cols-[auto_1fr_auto_auto]">
                <span className="mono w-7 text-center text-sm font-medium text-ink-3">{r.rank}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{r.teamName}</div>
                  <div className="flex items-center gap-1.5 text-xs text-ink-3">
                    <span className="truncate">{r.university}</span><span className="chip shrink-0">{r.track}</span>
                  </div>
                </div>
                <div className="w-16 text-right"><span className="nums text-base font-bold text-ink">{r.totalScore.toFixed(1)}</span></div>
                <div className="hidden w-16 justify-end sm:flex"><Trend v={r.trend} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ranked.length === 0 && <div className="card px-6 py-12 text-center text-sm text-ink-3">No teams in this track yet.</div>}
    </div>
  );
}

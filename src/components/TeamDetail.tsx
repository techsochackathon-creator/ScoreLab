"use client";

import { useState } from "react";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { StatusBadge } from "@/components/ui/misc";
import { ProgressBar, bandVar, totalBandVar } from "@/components/ui/ProgressBar";
import { RadarChart } from "@/components/charts/Charts";
import { Icon } from "@/components/ui/icons";

export interface TeamDetailData {
  id: string;
  teamCode: string;
  name: string;
  university: string;
  track: string;
  members: string[];
  projectTitle: string | null;
  projectDescription: string | null;
  technologies: string[];
  status: string | null;
  totalScore: number | null;
  repoUrl: string | null;
  rank: number | null;
  rankOf: number;
  scores: { id: string; name: string; score: number; scaleMax: number; weight: number; reasoning: string }[];
  radar: { axes: string[]; values: number[]; scaleMax: number; avg: number[] } | null;
  submissions: { id: string; status: string; totalScore: number | null; repoUrl: string; createdAt: string }[];
  history: { id: string; totalScore: number; createdAt: string }[];
}

const TABS = ["Overview", "Scores", "Evaluations", "Insights"] as const;
type Tab = (typeof TABS)[number];

export function TeamDetail({ data }: { data: TeamDetailData }) {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div className="mt-3 fade-in-up">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--glass-border)] pb-6">
        <div className="min-w-0">
          <div className="mono text-xs text-ink-3">{data.teamCode}</div>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink">{data.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>{data.university}</span>
            <span className="chip">{data.track}</span>
            {data.rank && <span className="chip">Rank {data.rank} of {data.rankOf}</span>}
          </div>
        </div>
        <div className="flex items-center gap-5">
          {data.status && <StatusBadge status={data.status} />}
          <ScoreRing value={data.totalScore} label="/ 100" size={104} stroke={9} color={data.totalScore != null ? totalBandVar(data.totalScore) : "var(--brand)"} />
        </div>
      </header>

      <div className="mt-4 flex gap-1 border-b border-[var(--glass-border)]">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${t === tab ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "Overview" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-ink">{data.projectTitle ?? "Project"}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{data.projectDescription ?? "No project description provided."}</p>
              {data.technologies.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">{data.technologies.map((t) => <span key={t} className="chip">{t}</span>)}</div>
              )}
              {data.repoUrl && (
                <a href={data.repoUrl} target="_blank" className="mono mt-4 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
                  {data.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}<Icon.external size={11} />
                </a>
              )}
            </div>
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">Members</h3>
              {data.members.length === 0 ? (
                <p className="text-sm text-ink-3">No members listed.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.members.map((m) => (
                    <li key={m} className="flex items-center gap-2.5 text-sm text-ink">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{m.charAt(0).toUpperCase()}</span>
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "Scores" && (
          data.scores.length === 0 ? (
            <p className="card px-4 py-8 text-center text-sm text-ink-3">No evaluated scores yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.scores.map((s) => (
                <div key={s.id} className="card p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-ink">{s.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="mono grid h-7 w-7 place-items-center rounded-md text-sm font-bold text-white" style={{ background: bandVar(s.score, s.scaleMax) }}>{s.score}</span>
                      <span className="mono text-xs text-ink-3">of {s.scaleMax}</span>
                      <span className="chip mono">weight {s.weight}%</span>
                    </div>
                  </div>
                  <ProgressBar value={s.score} max={s.scaleMax} color={bandVar(s.score, s.scaleMax)} className="mt-3" />
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.reasoning}</p>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "Evaluations" && (
          data.submissions.length === 0 ? (
            <p className="card px-4 py-8 text-center text-sm text-ink-3">No evaluations yet.</p>
          ) : (
            <div className="card divide-y divide-[var(--glass-border)] overflow-hidden">
              {data.submissions.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                  <StatusBadge status={s.status} />
                  <a href={s.repoUrl} target="_blank" className="mono min-w-0 flex-1 truncate text-xs text-ink-2 hover:text-ink">{s.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}</a>
                  <span className="text-xs text-ink-3">{new Date(s.createdAt).toLocaleString()}</span>
                  <span className="nums w-12 text-right text-sm font-bold text-ink">{s.totalScore == null ? "—" : s.totalScore.toFixed(1)}</span>
                  <a href={`/organizer/submissions/${s.id}`} className="link-brand text-xs">Open</a>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "Insights" && (
          data.radar && data.radar.axes.length >= 3 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card p-5">
                <h3 className="mb-1 text-sm font-semibold text-ink">Criterion profile</h3>
                <p className="mb-2 text-xs text-ink-3">This team&apos;s per-criterion scores (out of {data.radar.scaleMax}).</p>
                <RadarChart axes={data.radar.axes} values={data.radar.values} max={data.radar.scaleMax} />
              </div>
              <div className="card p-5">
                <h3 className="mb-3 text-sm font-semibold text-ink">Strengths vs. event average</h3>
                <div className="flex flex-col gap-3">
                  {data.radar.axes.map((a, i) => {
                    const v = data.radar!.values[i];
                    const avg = data.radar!.avg[i];
                    const diff = v - avg;
                    return (
                      <div key={a}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-ink-2">{a}</span>
                          <span className="nums" style={{ color: diff > 0.05 ? "var(--good)" : diff < -0.05 ? "var(--bad)" : "var(--ink-3)" }}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(1)} vs avg
                          </span>
                        </div>
                        <ProgressBar value={v} max={data.radar!.scaleMax} color={bandVar(v, data.radar!.scaleMax)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <p className="card px-4 py-8 text-center text-sm text-ink-3">Insights appear once this team has an evaluated submission with at least three criteria.</p>
          )
        )}
      </div>
    </div>
  );
}

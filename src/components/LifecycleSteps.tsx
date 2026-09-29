export type ResultsPhase = "JUDGING_OPEN" | "FINALIZED" | "PUBLISHED";

const STEPS: { phase: ResultsPhase; label: string }[] = [
  { phase: "JUDGING_OPEN", label: "Judging open" },
  { phase: "FINALIZED", label: "Finalized" },
  { phase: "PUBLISHED", label: "Published" },
];

/** Where the official result is in its lifecycle. State is shown with text and ✓, not colour alone. */
export function LifecycleSteps({ phase, className = "" }: { phase: ResultsPhase; className?: string }) {
  const current = STEPS.findIndex((s) => s.phase === phase);
  return (
    <ol className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className}`} aria-label="Results lifecycle">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.phase} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden className="text-ink-3">→</span>}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${
                active ? "border-brand text-ink" : done ? "border-[var(--glass-border)] text-ink-2" : "border-[var(--glass-border)] text-ink-3"
              }`}
              style={active ? { background: "var(--brand-tint)" } : undefined}
            >
              {done ? "✓" : `${i + 1}.`} {s.label}
              {active && <span className="sr-only"> (current)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

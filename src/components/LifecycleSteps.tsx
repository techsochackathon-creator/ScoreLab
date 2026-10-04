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
    <ol className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs ${className}`} aria-label="Results lifecycle">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.phase} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span aria-hidden className="h-px w-4 sm:w-8" style={{ background: done || active ? "var(--brand)" : "var(--hair-strong)" }} />}
            <span
              aria-hidden
              className="nums grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              style={
                active
                  ? { background: "var(--brand)", color: "var(--brand-fg)" }
                  : done
                    ? { background: "var(--brand-tint)", color: "var(--brand-text)", border: "1px solid rgb(var(--brand-rgb) / 0.4)" }
                    : { color: "var(--ink-3)", border: "1px solid var(--hair-strong)" }
              }
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={active ? "font-semibold text-ink" : done ? "font-medium text-ink-2" : "text-ink-3"}>
              {s.label}
              {done && <span className="sr-only"> (done)</span>}
              {active && <span className="sr-only"> (current)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

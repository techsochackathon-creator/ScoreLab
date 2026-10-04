/** ScoreLab mark + wordmark. Presentational only — wrap it in a link where it should navigate. */
export function Logo({ size = "md", wordmark = true }: { size?: "md" | "lg"; wordmark?: boolean }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-md font-bold ${lg ? "h-9 w-9 text-sm" : "h-7 w-7 text-[13px]"}`}
        style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
      >
        S
      </span>
      {wordmark && (
        <span className={`font-semibold tracking-tight text-ink ${lg ? "text-lg" : "text-[15px]"}`}>
          Score<span style={{ color: "var(--brand-text)" }}>Lab</span>
        </span>
      )}
    </span>
  );
}

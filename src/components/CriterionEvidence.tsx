import type { CriterionResultDetail } from "@/lib/dashboard";

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toFixed(d);

/**
 * Presentational, read-only rendering of one criterion's result + evidence
 * (raw metrics, build logs, screenshots). Shared by the organizer detail view
 * and the public team-results page.
 */
export function CriterionCard({ result }: { result: CriterionResultDetail }) {
  const d = (result.details ?? {}) as Record<string, unknown>;
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{result.criterionName}</span>
          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800">
            {result.checkType}
          </span>
        </div>
        <div className="text-right text-sm">
          <span className="font-semibold tabular-nums">
            {result.computedScore == null ? "—" : fmt(result.computedScore)}
          </span>
          <span className="text-gray-400">
            {" "}
            pts · weight {Math.round(result.weight * 100)}%
          </span>
        </div>
      </div>
      <CriterionEvidence
        checkType={result.checkType}
        rawMetric={result.rawMetric}
        d={d}
      />
    </div>
  );
}

export function CriterionEvidence({
  checkType,
  rawMetric,
  d,
}: {
  checkType: string;
  rawMetric: number | null;
  d: Record<string, unknown>;
}) {
  if (checkType === "responsiveness") {
    const viewports =
      (d.viewports as
        | {
            width: number;
            ok: boolean;
            overflow: boolean;
            status: number | null;
            blobUrl: string | null;
          }[]
        | undefined) ?? [];
    return (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {viewports.map((v) => (
          <figure key={v.width} className="text-xs">
            {v.blobUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.blobUrl}
                alt={`${v.width}px screenshot`}
                className="max-h-64 w-full rounded border border-gray-200 object-cover object-top dark:border-gray-800"
              />
            ) : (
              <div className="flex h-32 items-center justify-center rounded border border-dashed text-gray-400">
                no screenshot
              </div>
            )}
            <figcaption className="mt-1 flex items-center justify-between">
              <span>{v.width}px</span>
              <span className={v.ok ? "text-green-600" : "text-red-600"}>
                {v.ok ? "ok" : v.overflow ? "overflow" : "fail"}
                {v.status ? ` · ${v.status}` : ""}
              </span>
            </figcaption>
          </figure>
        ))}
        {viewports.length === 0 && (
          <p className="text-xs text-gray-500">No viewport data.</p>
        )}
      </div>
    );
  }

  if (checkType === "build_success") {
    const logs = typeof d.logsTail === "string" ? d.logsTail : "";
    return (
      <div className="mt-3">
        <div className="text-xs text-gray-500">
          install exit: {String(d.installExit ?? "—")} · server reachable:{" "}
          {String(d.startReachable ?? "—")} · http:{" "}
          {String(d.startHttpCode ?? "—")}
        </div>
        {logs && (
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
            {logs}
          </pre>
        )}
      </div>
    );
  }

  if (checkType === "code_quality") {
    const subChecks =
      (d.subChecks as
        | { label: string; passed: boolean; points: number }[]
        | undefined) ?? [];
    const authorship = d.authorship as
      | { authors: number; totalCommits: number; minCommits: number }
      | undefined;
    return (
      <div className="mt-3 text-xs">
        <ul className="space-y-0.5">
          {subChecks.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={s.passed ? "text-green-600" : "text-red-500"}>
                {s.passed ? "✓" : "✕"}
              </span>
              <span>{s.label}</span>
              <span className="text-gray-400">({s.points} pts)</span>
            </li>
          ))}
        </ul>
        {authorship && (
          <p className="mt-2 text-gray-500">
            {authorship.authors} author(s), {authorship.totalCommits} commits,
            min {authorship.minCommits}/author
          </p>
        )}
      </div>
    );
  }

  if (checkType === "lighthouse_perf" || checkType === "lighthouse_a11y") {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Lighthouse score: {rawMetric ?? "— (no liveUrl / unavailable)"}
      </p>
    );
  }

  if (checkType === "uptime") {
    return (
      <p className="mt-2 text-xs text-gray-500">
        HTTP status: {String(d.httpStatus ?? "—")}
        {d.responseMs != null ? ` · ${String(d.responseMs)}ms` : ""}
        {d.note ? ` · ${String(d.note)}` : ""}
      </p>
    );
  }

  if (checkType === "human_score") {
    return (
      <p className="mt-2 text-xs text-gray-500">Entered by a judge.</p>
    );
  }

  return (
    <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-[11px] dark:bg-gray-900">
      {JSON.stringify(d, null, 2)}
    </pre>
  );
}

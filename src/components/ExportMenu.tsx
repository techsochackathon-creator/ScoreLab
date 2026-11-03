"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { readApiError } from "@/lib/uiErrors";

type Format = "csv" | "xlsx";

/** Local-date filename, e.g. ScoreLab_Teams_2026-11-04.xlsx */
function filename(kind: "teams" | "results", format: Format) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `ScoreLab_${kind === "teams" ? "Teams" : "Results"}_${ymd}.${format}`;
}

/**
 * "Export: CSV | Excel" control. The file is generated server-side by the
 * organizer-only /api/organizer/export route; both buttons are disabled while one
 * export is running, so it can't be triggered twice.
 */
export function ExportMenu({ kind }: { kind: "teams" | "results" }) {
  const toast = useToast();
  const [busy, setBusy] = useState<Format | null>(null);

  async function run(format: Format) {
    if (busy) return;
    setBusy(format);
    try {
      const res = await fetch(`/api/organizer/export/${kind}?format=${format}`).catch(() => null);
      if (!res) return toast("Network error — the export could not be downloaded.", "error");
      if (!res.ok) return toast(await readApiError(res, "The export could not be generated."), "error");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename(kind, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`${format === "csv" ? "CSV" : "Excel"} export downloaded`);
    } finally {
      setBusy(null);
    }
  }

  const label = kind === "teams" ? "teams" : "results";
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`Export ${label}`}>
      <span className="text-xs font-medium text-ink-3">Export</span>
      <button type="button" onClick={() => run("csv")} disabled={busy !== null} className="btn-ghost" aria-busy={busy === "csv"} aria-label={`Export ${label} as CSV`}>
        {busy === "csv" ? "Preparing…" : "CSV"}
      </button>
      <button type="button" onClick={() => run("xlsx")} disabled={busy !== null} className="btn-ghost" aria-busy={busy === "xlsx"} aria-label={`Export ${label} as Excel (.xlsx)`}>
        {busy === "xlsx" ? "Preparing…" : "Excel (.xlsx)"}
      </button>
    </div>
  );
}

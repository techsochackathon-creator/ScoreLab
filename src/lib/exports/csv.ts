/**
 * Minimal RFC 4180 CSV writer for exports.
 *
 * - UTF-8 with a byte-order mark, so Excel shows non-ASCII names correctly
 * - CRLF line endings; fields with comma, quote or newline are quoted, quotes doubled
 * - Formula-injection guard: TEXT cells starting with = + - @ (or tab / CR) get a
 *   leading apostrophe, so a team name like "=HYPERLINK(...)" can't run as a
 *   formula when the file is opened in a spreadsheet. Numbers are never altered.
 * - null / undefined → empty field
 */
export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvField).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** "2026-11-04 09:30" in UTC — unambiguous and parsed by spreadsheets. */
export function csvDateTime(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "";
}

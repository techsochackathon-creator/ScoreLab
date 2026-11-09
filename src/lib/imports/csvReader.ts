/**
 * CSV → text rows (RFC 4180 quoting). Strips the UTF-8 BOM that Excel adds, keeps blank
 * rows so row numbers match the spreadsheet, and detects the delimiter from the header
 * line: comma, or semicolon / tab (Excel in many locales saves "CSV" with semicolons).
 */
export function readCsvRows(text: string): string[][] {
  const s = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const firstLine = s.slice(0, s.indexOf("\n") >= 0 ? s.indexOf("\n") : s.length);
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

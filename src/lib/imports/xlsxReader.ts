import { unzipSync, strFromU8 } from "fflate";

/**
 * Minimal .xlsx reader: returns the cells of the FIRST worksheet as text rows.
 *
 * Only what a team import needs: shared strings, inline strings, numbers and
 * booleans. Formulas are read as their cached value (never evaluated). Old binary
 * .xls files are not supported (they are not zip files).
 */

export class XlsxReadError extends Error {}

/** Upload cap, and a cap on the unpacked size so a tiny "zip bomb" can't exhaust memory. */
export const MAX_XLSX_BYTES = 4 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "amp") return "&";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });

/** Text of every <t> run, skipping phonetic hints (<rPh>). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Whole numbers print without ".0"; long decimals are trimmed of float noise. */
function numberText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

/** Resolve the first sheet's path via the workbook and its relationships. */
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const sheet = /<sheet\b[^>]*>/.exec(wb)?.[0] ?? "";
  const rid = /\br:id="([^"]+)"/.exec(sheet)?.[1] ?? /\bid="([^"]+)"/.exec(sheet)?.[1];
  if (rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (new RegExp(`\\bId="${rid}"`).test(m[0])) {
        const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
        if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      }
    }
  }
  const fallback = Object.keys(files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()[0];
  if (!fallback) throw new XlsxReadError("The Excel file has no worksheet.");
  return fallback;
}

export function readXlsxRows(bytes: Uint8Array): string[][] {
  if (bytes.length > MAX_XLSX_BYTES) throw new XlsxReadError("The file is too large (max 4 MB).");
  // .xlsx is a zip ("PK"); old .xls is not.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new XlsxReadError("This isn't an .xlsx file. In Excel, use File → Save As → Excel Workbook (.xlsx), or save as CSV.");
  }

  let unpacked = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        const wanted = f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" ||
          f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
        if (!wanted) return false;
        unpacked += f.originalSize;
        if (unpacked > MAX_UNZIPPED_BYTES) throw new XlsxReadError("The Excel file is too large to import.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof XlsxReadError) throw e;
    throw new XlsxReadError("The Excel file could not be opened. It may be damaged or password-protected.");
  }

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const m of strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
      shared.push(m[1] ? textOf(m[1]) : "");
    }
  }

  const path = firstSheetPath(files);
  const xml = files[path] ? strFromU8(files[path]) : "";
  if (!xml) throw new XlsxReadError("The Excel file has no worksheet.");

  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNum = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = textOf(body);
      else if (type === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (type === "str" || type === "e") text = v != null ? decodeXml(v) : "";
      else text = v != null ? numberText(decodeXml(v)) : "";
      cells[col] = text;
    }
    // Keep row positions so error messages can name the real Excel row.
    while (rows.length < rowNum - 1) rows.push([]);
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

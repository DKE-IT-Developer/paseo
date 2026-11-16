import * as XLSX from "xlsx";
import { SHEET_MAX_COLS } from "../../shared/limits";

export interface ParsedSheet {
  name: string;
  rows: string[][];
  truncated: boolean;
  /** True when the sheet is wider than SHEET_MAX_COLS and only the first columns are shown. */
  colsTruncated: boolean;
}

export function parseWorkbook(bytes: Uint8Array, maxRows: number): { sheets: ParsedSheet[] } {
  // sheetRows: parse only maxRows + 1 rows (the extra row tells us whether we truncated).
  const wb = XLSX.read(bytes, { type: "array", sheetRows: maxRows + 1 });
  const sheets = wb.SheetNames.map((name): ParsedSheet => {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) return { name, rows: [], truncated: false, colsTruncated: false };
    const full = XLSX.utils.decode_range(ref);
    const total = full.e.r - full.s.r + 1;
    const truncated = total > maxRows;
    // Width comes from `!ref`, which real files often stretch to column XFD (whole-row
    // formatting); with defval + blankrows sheet_to_json would fill that whole rectangle.
    const colsTruncated = full.e.c - full.s.c + 1 > SHEET_MAX_COLS;
    const range = {
      s: full.s,
      e: {
        c: colsTruncated ? full.s.c + SHEET_MAX_COLS - 1 : full.e.c,
        r: truncated ? full.s.r + maxRows - 1 : full.e.r,
      },
    };
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
      range,
    });
    const rows = data.map((r) => r.map((c) => (c == null ? "" : String(c))));
    return { name, rows, truncated, colsTruncated };
  });
  return { sheets };
}

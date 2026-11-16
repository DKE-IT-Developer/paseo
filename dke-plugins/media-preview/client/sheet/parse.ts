import * as XLSX from "xlsx";

export interface ParsedSheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}

export function parseWorkbook(bytes: Uint8Array, maxRows: number): { sheets: ParsedSheet[] } {
  // sheetRows: parse only maxRows + 1 rows (the extra row tells us whether we truncated).
  const wb = XLSX.read(bytes, { type: "array", sheetRows: maxRows + 1 });
  const sheets = wb.SheetNames.map((name): ParsedSheet => {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) return { name, rows: [], truncated: false };
    const full = XLSX.utils.decode_range(ref);
    const total = full.e.r - full.s.r + 1;
    const truncated = total > maxRows;
    const range = truncated ? { s: full.s, e: { c: full.e.c, r: full.s.r + maxRows - 1 } } : full;
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
      range,
    });
    const rows = data.map((r) => r.map((c) => (c == null ? "" : String(c))));
    return { name, rows, truncated };
  });
  return { sheets };
}

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { SHEET_MAX_COLS } from "../../shared/limits";
import { parseWorkbook } from "./parse";

function makeBook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Nama", "Jumlah"],
      ["Apel", 3],
      ["Jeruk", 12.5],
    ]),
    "Buah",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"], ["y"]]), "Lain");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("parseWorkbook", () => {
  it("returns sheet names and cells as strings", () => {
    const { sheets } = parseWorkbook(makeBook(), 100);
    expect(sheets.map((s) => s.name)).toEqual(["Buah", "Lain"]);
    expect(sheets[0].rows).toEqual([
      ["Nama", "Jumlah"],
      ["Apel", "3"],
      ["Jeruk", "12.5"],
    ]);
    expect(sheets[0].truncated).toBe(false);
  });

  it("truncates at maxRows", () => {
    const { sheets } = parseWorkbook(makeBook(), 2);
    expect(sheets[0].rows).toHaveLength(2);
    expect(sheets[0].truncated).toBe(true);
    expect(sheets[1].rows).toHaveLength(2);
    expect(sheets[1].truncated).toBe(false);
  });

  it("sheetRows limits parsed rows and sets truncated", () => {
    const wb = XLSX.utils.book_new();
    const aoa = Array.from({ length: 50 }, (_, i) => [`r${i}`, i]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Besar");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const { sheets } = parseWorkbook(bytes, 10);
    expect(sheets[0].rows).toHaveLength(10);
    expect(sheets[0].rows[9]).toEqual(["r9", "9"]);
    expect(sheets[0].truncated).toBe(true);
    const exact = parseWorkbook(bytes, 50).sheets[0];
    expect(exact.rows).toHaveLength(50);
    expect(exact.truncated).toBe(false);
  });

  it("caps columns when !ref spans the whole row width (A1:XFD300)", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Nama", "Jumlah"],
      ["Apel", 3],
    ]);
    // Whole-row formatting in real Excel files makes the dimension span to XFD.
    ws["!ref"] = "A1:XFD300";
    XLSX.utils.book_append_sheet(wb, ws, "Lebar");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    expect(bytes.length).toBeLessThan(100_000);
    const t0 = performance.now();
    const sheet = parseWorkbook(bytes, 5000).sheets[0];
    const elapsed = performance.now() - t0;
    expect(sheet.colsTruncated).toBe(true);
    expect(sheet.rows).toHaveLength(300);
    for (const row of sheet.rows) expect(row.length).toBeLessThanOrEqual(SHEET_MAX_COLS);
    expect(sheet.rows[0].slice(0, 2)).toEqual(["Nama", "Jumlah"]);
    // Fixture writing dominates; parsing alone is milliseconds once columns are capped.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("does not flag colsTruncated for narrow sheets", () => {
    const sheet = parseWorkbook(makeBook(), 100).sheets[0];
    expect(sheet.colsTruncated).toBe(false);
  });
});

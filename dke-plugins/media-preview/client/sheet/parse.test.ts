import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
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
});

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
});

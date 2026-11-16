import { describe, expect, it } from "vitest";
import { findMediaPaths } from "./find-paths";
import { fileLinkMarkdown } from "./file-link";

describe("fileLinkMarkdown", () => {
  it("percent-encodes spaces and parentheses so the host opens the file", () => {
    expect(fileLinkMarkdown("/tmp/dir/presentasi (uji) final.pptx")).toBe(
      "[Buka di panel](/tmp/dir/presentasi%20%28uji%29%20final.pptx)",
    );
  });

  it("keeps a home path prefix readable", () => {
    expect(fileLinkMarkdown("~/Documents/a b.pdf")).toBe("[Buka di panel](~/Documents/a%20b.pdf)");
  });

  it("round-trips through findMediaPaths", () => {
    const path = "/tmp/Laporan Ünicode (2) 100%.docx";
    expect(findMediaPaths(fileLinkMarkdown(path)).map((f) => f.path)).toEqual([path]);
  });
});

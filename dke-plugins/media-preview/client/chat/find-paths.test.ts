import { describe, expect, it } from "vitest";
import { findMediaPaths } from "./find-paths";

const paths = (text: string) => findMediaPaths(text).map((f) => f.path);

describe("findMediaPaths", () => {
  it("finds absolute path in prose", () => {
    expect(findMediaPaths("Hasilnya ada di /tmp/rekaman.mp3.")).toEqual([
      { path: "/tmp/rekaman.mp3", kind: "audio" },
    ]);
  });

  it("finds home paths and strips trailing punctuation", () => {
    expect(paths("Lihat (~/Documents/laporan.pdf), lalu ~/Desktop/a.xlsx:")).toEqual([
      "~/Documents/laporan.pdf",
      "~/Desktop/a.xlsx",
    ]);
  });

  it("finds paths with spaces in backticks", () => {
    expect(findMediaPaths("File `/tmp/rapat final.mp3` siap")).toEqual([
      { path: "/tmp/rapat final.mp3", kind: "audio" },
    ]);
  });

  it("finds markdown link target", () => {
    expect(paths("[unduh](/a/b.mp3) dan [lagi](</a/c d (1).mp4>)")).toEqual([
      "/a/b.mp3",
      "/a/c d (1).mp4",
    ]);
  });

  it("finds file:// urls and percent-decodes", () => {
    expect(paths("buka file:///tmp/rapat%20final.docx sekarang")).toEqual([
      "/tmp/rapat final.docx",
    ]);
  });

  it("ignores https URLs", () => {
    expect(paths("unduh https://x.com/a/b.mp3 atau http://x.com/c.pdf")).toEqual([]);
  });

  it("skips relative paths", () => {
    expect(paths("lihat docs/a.mp3 dan ./b.pdf dan ../c.mp4")).toEqual([]);
  });

  it("dedupes keeping first-occurrence order", () => {
    expect(paths("/tmp/b.pdf lalu /tmp/a.mp3 lalu `/tmp/b.pdf` lagi [x](/tmp/a.mp3)")).toEqual([
      "/tmp/b.pdf",
      "/tmp/a.mp3",
    ]);
  });

  it("returns [] for csv", () => {
    expect(findMediaPaths("data di /tmp/data.csv dan /tmp/notes.txt")).toEqual([]);
  });
});

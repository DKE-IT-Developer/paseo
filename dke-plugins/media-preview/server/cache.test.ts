import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheDirFor, cacheKey, pruneCache } from "./cache";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dke-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePdf(name: string, bytes: number, atimeSec: number) {
  const file = path.join(dir, name);
  await writeFile(file, Buffer.alloc(bytes, 1));
  await utimes(file, atimeSec, atimeSec);
}

describe("cacheKey", () => {
  it("is a sha256 hex string", () => {
    expect(cacheKey("/a/b.docx", 10, 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cache key changes with mtime", () => {
    expect(cacheKey("/a/b.docx", 10, 1)).not.toBe(cacheKey("/a/b.docx", 10, 2));
    expect(cacheKey("/a/b.docx", 10, 1)).not.toBe(cacheKey("/a/b.docx", 11, 1));
    expect(cacheKey("/a/b.docx", 10, 1)).not.toBe(cacheKey("/a/c.docx", 10, 1));
    expect(cacheKey("/a/b.docx", 10, 1)).toBe(cacheKey("/a/b.docx", 10, 1));
  });
});

describe("cacheDirFor", () => {
  it("uses PASEO_HOME when set, else ~/.paseo", () => {
    expect(cacheDirFor({ PASEO_HOME: "/x/home" }, "/Users/u")).toBe(
      "/x/home/plugin-cache/dke-media-preview",
    );
    expect(cacheDirFor({}, "/Users/u")).toBe("/Users/u/.paseo/plugin-cache/dke-media-preview");
  });
});

describe("pruneCache", () => {
  it("pruneCache keeps total under max, oldest first", async () => {
    await writePdf("old.pdf", 100, 1_000);
    await writePdf("mid.pdf", 100, 2_000);
    await writePdf("new.pdf", 100, 3_000);
    await pruneCache(dir, 250);
    expect((await readdir(dir)).sort()).toEqual(["mid.pdf", "new.pdf"]);
    await pruneCache(dir, 100);
    expect(await readdir(dir)).toEqual(["new.pdf"]);
  });

  it("never deletes excluded files and ignores non-pdf entries", async () => {
    await writePdf("keep.pdf", 100, 1_000);
    await writePdf("other.pdf", 100, 2_000);
    await writePdf("notes.txt", 500, 500);
    await mkdir(path.join(dir, "lo-profile"));
    await pruneCache(dir, 50, ["keep.pdf"]);
    expect((await readdir(dir)).sort()).toEqual(["keep.pdf", "lo-profile", "notes.txt"]);
  });

  it("does nothing when the directory does not exist", async () => {
    await expect(pruneCache(path.join(dir, "missing"), 10)).resolves.toBeUndefined();
  });
});

describe("pruneCache with previews", () => {
  it("counts and evicts preview mp4/mp3 alongside pdfs, but not other files", async () => {
    await writePdf("a.preview.mp4", 100, 1_000);
    await writePdf("b.preview.mp3", 100, 2_000);
    await writePdf("c.pdf", 100, 3_000);
    await writePdf("film.mp4", 500, 500);
    await pruneCache(dir, 150);
    expect((await readdir(dir)).sort()).toEqual(["c.pdf", "film.mp4"]);
  });

  it("cacheKey salt changes the key and no salt keeps the old key", () => {
    expect(cacheKey("/a/b.mp4", 10, 1, "preview")).not.toBe(cacheKey("/a/b.mp4", 10, 1));
    expect(cacheKey("/a/b.mp4", 10, 1, "")).toBe(cacheKey("/a/b.mp4", 10, 1));
  });
});

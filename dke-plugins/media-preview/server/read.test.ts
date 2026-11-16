import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHUNK_BYTES } from "../shared/limits";
import { PathNotAllowedError } from "./paths";
import { createReadHandlers } from "./read";

let base: string;
let root: string;
let handlers: ReturnType<typeof createReadHandlers>;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "dke-read-")));
  root = path.join(base, "root");
  await mkdir(root);
  handlers = createReadHandlers(async () => [root]);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("read", () => {
  it("reads 9 MB file in 3 chunks", async () => {
    const size = 9 * 1024 * 1024;
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) data[i] = i % 251;
    const file = path.join(root, "big.mp4");
    await writeFile(file, data);

    const parts: Buffer[] = [];
    const offsets: number[] = [];
    const eofs: boolean[] = [];
    let offset = 0;
    for (;;) {
      offsets.push(offset);
      const r = await handlers.read({ path: file, offset });
      parts.push(Buffer.from(r.base64, "base64"));
      eofs.push(r.eof);
      if (r.eof) break;
      offset = r.nextOffset;
    }
    expect(offsets).toEqual([0, CHUNK_BYTES, 2 * CHUNK_BYTES]);
    expect(eofs).toEqual([false, false, true]);
    expect(Buffer.concat(parts).equals(data)).toBe(true);
  });

  it("read outside roots throws", async () => {
    const outside = path.join(base, "secret.pdf");
    await writeFile(outside, "x");
    await expect(handlers.read({ path: outside, offset: 0 })).rejects.toBeInstanceOf(
      PathNotAllowedError,
    );
  });

  it("rejects directories", async () => {
    const dir = path.join(root, "folder.pdf");
    await mkdir(dir);
    await expect(handlers.stat({ path: dir })).rejects.toThrow("Bukan berkas biasa");
    await expect(handlers.read({ path: dir, offset: 0 })).rejects.toThrow("Bukan berkas biasa");
  });

  it("rejects files that are not a media kind", async () => {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "secret");
    await expect(handlers.stat({ path: file })).rejects.toThrow("Jenis berkas tidak didukung");
    await expect(handlers.read({ path: file, offset: 0 })).rejects.toThrow(
      "Jenis berkas tidak didukung",
    );
  });

  it("rejects a fifo without blocking", async () => {
    const fifo = path.join(root, "pipe.mp3");
    execFileSync("mkfifo", [fifo]);
    await expect(handlers.read({ path: fifo, offset: 0 })).rejects.toThrow("Bukan berkas biasa");
  });

  it("returns eof for offset at or past end", async () => {
    const file = path.join(root, "a.mp3");
    await writeFile(file, "abc");
    const r = await handlers.read({ path: file, offset: 3 });
    expect(r).toEqual({ base64: "", nextOffset: 3, eof: true });
  });
});

describe("stat", () => {
  it("stat returns mime audio/mpeg for .mp3", async () => {
    const file = path.join(root, "a.mp3");
    await writeFile(file, "abc");
    const s = await handlers.stat({ path: file });
    expect(s.mimeType).toBe("audio/mpeg");
    expect(s.size).toBe(3);
    expect(s.mtimeMs).toBeGreaterThan(0);
  });

  it("expands ~/ to the injected home before checking roots", async () => {
    await mkdir(path.join(root, "Documents"));
    await writeFile(path.join(root, "Documents", "a.mp3"), "abc");
    const homed = createReadHandlers(async () => [root], root);
    expect((await homed.stat({ path: "~/Documents/a.mp3" })).size).toBe(3);
  });
});

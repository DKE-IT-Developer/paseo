import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { fileKind, mimeForPath } from "../shared/kinds";
import { CHUNK_BYTES } from "../shared/limits";
import { resolveAllowedPath } from "./paths";

export class NotRegularFileError extends Error {
  constructor() {
    super("Bukan berkas biasa");
    this.name = "NotRegularFileError";
  }
}

export class UnsupportedKindError extends Error {
  constructor() {
    super("Jenis berkas tidak didukung");
    this.name = "UnsupportedKindError";
  }
}

export interface FileChunk {
  base64: string;
  nextOffset: number;
  eof: boolean;
}

/**
 * Reads up to CHUNK_BYTES of a regular file starting at `offset`.
 * O_NONBLOCK keeps a FIFO from blocking the open; the type check uses the
 * opened handle so the file cannot be swapped between check and read.
 */
export async function readFileChunk(realPath: string, offset: number): Promise<FileChunk> {
  const handle = await open(realPath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new NotRegularFileError();
    const want = Math.max(0, Math.min(CHUNK_BYTES, info.size - offset));
    const buffer = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await handle.read(buffer, got, want - got, offset + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    const nextOffset = offset + got;
    return {
      base64: buffer.subarray(0, got).toString("base64"),
      nextOffset,
      eof: got === 0 || nextOffset >= info.size,
    };
  } finally {
    await handle.close();
  }
}

export function createReadHandlers(getRoots: () => Promise<string[]>) {
  async function resolveMedia(target: string): Promise<string> {
    const real = await resolveAllowedPath(target, await getRoots());
    if (fileKind(real) === null) throw new UnsupportedKindError();
    return real;
  }

  return {
    async stat({ path }: { path: string }) {
      const real = await resolveMedia(path);
      const info = await stat(real);
      if (!info.isFile()) throw new NotRegularFileError();
      return { size: info.size, mtimeMs: info.mtimeMs, mimeType: mimeForPath(real) };
    },
    async read({ path, offset }: { path: string; offset: number }) {
      return readFileChunk(await resolveMedia(path), offset);
    },
  };
}

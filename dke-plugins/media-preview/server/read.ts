import { open, stat } from "node:fs/promises";
import { mimeForPath } from "../shared/kinds";
import { CHUNK_BYTES } from "../shared/limits";
import { resolveAllowedPath } from "./paths";

export class NotRegularFileError extends Error {
  constructor() {
    super("Bukan berkas biasa");
    this.name = "NotRegularFileError";
  }
}

export function createReadHandlers(getRoots: () => Promise<string[]>) {
  async function resolveRegular(target: string) {
    const real = await resolveAllowedPath(target, await getRoots());
    const info = await stat(real);
    if (!info.isFile()) throw new NotRegularFileError();
    return { real, info };
  }

  return {
    async stat({ path }: { path: string }) {
      const { real, info } = await resolveRegular(path);
      return { size: info.size, mtimeMs: info.mtimeMs, mimeType: mimeForPath(real) };
    },
    async read({ path, offset }: { path: string; offset: number }) {
      const { real, info } = await resolveRegular(path);
      const handle = await open(real, "r");
      try {
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
    },
  };
}

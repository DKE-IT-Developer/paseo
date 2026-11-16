import { describe, expect, it } from "vitest";
import {
  TooLargeError,
  decodeBase64,
  encodeBase64,
  isAbortError,
  readAllChunks,
} from "./read-chunks";

describe("encodeBase64", () => {
  it("round-trips every padding length and matches Node's encoder", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 1000]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) % 256;
      const encoded = encodeBase64(data);
      expect(encoded).toBe(Buffer.from(data).toString("base64"));
      expect(decodeBase64(encoded)).toEqual(data);
    }
  });
});

describe("readAllChunks", () => {
  it("reassembles chunks byte-exact", async () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
    const sizes = [1, 400, 599]; // exercises all base64 padding variants
    const call = async (offset: number) => {
      const idx = [0, 1, 401].indexOf(offset);
      const end = offset + sizes[idx];
      return {
        base64: Buffer.from(data.subarray(offset, end)).toString("base64"),
        nextOffset: end,
        eof: end >= data.length,
      };
    };
    const out = await readAllChunks(call, 5000, data.length);
    expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
  });

  it("rejects TooLargeError before first call", async () => {
    let calls = 0;
    const call = async () => {
      calls++;
      return { base64: "", nextOffset: 0, eof: true };
    };
    await expect(readAllChunks(call, 10, 11)).rejects.toBeInstanceOf(TooLargeError);
    expect(calls).toBe(0);
  });

  it("decodes padded and empty base64", () => {
    expect(Array.from(decodeBase64(""))).toEqual([]);
    expect(Array.from(decodeBase64("YQ=="))).toEqual([97]);
    expect(Array.from(decodeBase64("YWI="))).toEqual([97, 98]);
  });
});

describe("readAllChunks options", () => {
  // 3 chunks of 3 bytes each.
  const call = async (offset: number) => ({
    base64: "AAAA",
    nextOffset: offset + 3,
    eof: offset + 3 >= 9,
  });

  it("reports cumulative bytes and the total after every chunk", async () => {
    const seen: [number, number][] = [];
    const out = await readAllChunks(call, 100, 9, { onProgress: (r, t) => seen.push([r, t]) });
    expect(out.length).toBe(9);
    expect(seen).toEqual([
      [3, 9],
      [6, 9],
      [9, 9],
    ]);
  });

  it("abort stops further calls and rejects with an abort error", async () => {
    const controller = new AbortController();
    const offsets: number[] = [];
    const run = readAllChunks(
      async (offset) => {
        offsets.push(offset);
        return call(offset);
      },
      100,
      9,
      {
        signal: controller.signal,
        onProgress: (read) => {
          if (read === 3) controller.abort();
        },
      },
    );
    const error = await run.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(offsets).toEqual([0]);
  });

  it("an already aborted signal makes no call", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const error = await readAllChunks(
      async (offset) => {
        calls++;
        return call(offset);
      },
      100,
      9,
      { signal: controller.signal },
    ).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(calls).toBe(0);
  });

  it("abort during a slow call rejects without waiting for it", async () => {
    const controller = new AbortController();
    const never = new Promise<never>(() => {});
    const run = readAllChunks(() => never, 100, 9, { signal: controller.signal });
    controller.abort();
    expect(isAbortError(await run.catch((e: unknown) => e))).toBe(true);
  });
});

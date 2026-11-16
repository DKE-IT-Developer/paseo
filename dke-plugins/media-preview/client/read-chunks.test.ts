import { describe, expect, it } from "vitest";
import { TooLargeError, decodeBase64, readAllChunks } from "./read-chunks";

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

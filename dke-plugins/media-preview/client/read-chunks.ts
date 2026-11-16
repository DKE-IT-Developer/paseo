export class TooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly maxBytes: number,
  ) {
    super("Berkas terlalu besar untuk dimuat");
    this.name = "TooLargeError";
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

/** Pure base64 -> bytes decoder (no atob/Buffer; safe for React Native). */
export function decodeBase64(input: string): Uint8Array {
  let len = input.length;
  while (len > 0 && input.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOKUP[input.charCodeAt(i) & 255];
    if (v === 255) throw new Error("Base64 tidak valid");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

export async function readAllChunks(
  call: (offset: number) => Promise<{ base64: string; nextOffset: number; eof: boolean }>,
  maxBytes: number,
  size: number,
): Promise<Uint8Array> {
  if (size > maxBytes) throw new TooLargeError(size, maxBytes);
  const parts: Uint8Array[] = [];
  let total = 0;
  let offset = 0;
  for (;;) {
    const chunk = await call(offset);
    const bytes = decodeBase64(chunk.base64);
    parts.push(bytes);
    total += bytes.length;
    if (total > maxBytes) throw new TooLargeError(total, maxBytes);
    if (chunk.eof) break;
    if (chunk.nextOffset <= offset) throw new Error("Pembacaan berkas tidak maju");
    offset = chunk.nextOffset;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

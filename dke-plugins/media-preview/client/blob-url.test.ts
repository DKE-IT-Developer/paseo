import { afterEach, describe, expect, it } from "vitest";
import { toBlobUrl } from "./blob-url";

const g = globalThis as unknown as { Blob: unknown };
const realBlob = g.Blob;

afterEach(() => {
  g.Blob = realBlob;
});

describe("toBlobUrl", () => {
  it("returns null when the Blob constructor rejects binary parts (React Native)", () => {
    // React Native defines Blob and URL.createObjectURL but throws on ArrayBuffer/Uint8Array parts.
    g.Blob = function ReactNativeBlob() {
      throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported");
    };
    expect(toBlobUrl(new Uint8Array([1, 2, 3]), "audio/mpeg")).toBeNull();
  });
});

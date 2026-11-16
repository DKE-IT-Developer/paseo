// Narrow local types: the plugin bundle is platform-neutral and has no DOM lib.
interface BlobGlobals {
  URL?: {
    createObjectURL?: (blob: unknown) => string;
    revokeObjectURL?: (url: string) => void;
  };
  Blob?: new (parts: unknown[], options?: { type?: string }) => unknown;
}

const g = globalThis as unknown as BlobGlobals;

/** Returns a blob: URL on web, or null when Blob/URL.createObjectURL is unavailable (native). */
export function toBlobUrl(bytes: Uint8Array, mime: string): string | null {
  const create = g.URL?.createObjectURL;
  const BlobCtor = g.Blob;
  if (typeof create !== "function" || typeof BlobCtor !== "function") return null;
  return create.call(g.URL, new BlobCtor([bytes], { type: mime }));
}

export function revokeBlobUrl(url: string): void {
  g.URL?.revokeObjectURL?.(url);
}

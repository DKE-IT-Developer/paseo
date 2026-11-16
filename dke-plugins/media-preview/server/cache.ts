import { createHash } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function cacheDirFor(env: NodeJS.ProcessEnv, home: string): string {
  return path.join(
    env.PASEO_HOME ?? path.join(home, ".paseo"),
    "plugin-cache",
    "dke-media-preview",
  );
}

export function defaultCacheDir(): string {
  return cacheDirFor(process.env, os.homedir());
}

/**
 * `salt` separates outputs of the same file (e.g. "preview"); without it the key is the
 * original PDF key, so existing cached PDFs stay valid.
 */
export function cacheKey(realPath: string, size: number, mtimeMs: number, salt = ""): string {
  const base = `${realPath}\0${size}\0${mtimeMs}`;
  return createHash("sha256")
    .update(salt ? `${base}\0${salt}` : base)
    .digest("hex");
}

/** Cached outputs that count toward (and are evicted by) pruneCache. */
const CACHED_SUFFIXES = [".pdf", ".preview.mp4", ".preview.mp3"];

/**
 * Deletes top-level cached outputs (`*.pdf`, `*.preview.mp4|mp3`) in `dir`, least recently
 * accessed first,
 * until their total size is at most `maxBytes`. Names in `exclude` are never
 * deleted (the output a caller has just produced or is about to serve).
 */
export async function pruneCache(
  dir: string,
  maxBytes: number,
  exclude: readonly string[] = [],
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const files: { name: string; size: number; atimeMs: number }[] = [];
  for (const name of names) {
    if (!CACHED_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    try {
      const info = await stat(path.join(dir, name));
      if (info.isFile()) files.push({ name, size: info.size, atimeMs: info.atimeMs });
    } catch {
      // Removed concurrently; nothing to count.
    }
  }
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= maxBytes) return;
  const keep = new Set(exclude);
  files.sort((a, b) => a.atimeMs - b.atimeMs);
  for (const file of files) {
    if (total <= maxBytes) break;
    if (keep.has(file.name)) continue;
    try {
      await unlink(path.join(dir, file.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    total -= file.size;
  }
}

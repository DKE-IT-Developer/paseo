import { realpath } from "node:fs/promises";
import path from "node:path";

export class PathNotAllowedError extends Error {
  constructor(message = "Path tidak diizinkan") {
    super(message);
    this.name = "PathNotAllowedError";
  }
}

export function allowedRoots(workspaceDirs: string[], home: string): string[] {
  const safeDirs = workspaceDirs.filter((dir) => path.isAbsolute(dir) && path.resolve(dir) !== "/");
  return [
    ...safeDirs,
    "/tmp",
    "/private/tmp",
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
  ];
}

function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

export async function resolveAllowedPath(target: string, roots: string[]): Promise<string> {
  if (!path.isAbsolute(target)) throw new PathNotAllowedError();
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new PathNotAllowedError();
  }
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    if (isInside(realRoot, real)) return real;
  }
  throw new PathNotAllowedError();
}

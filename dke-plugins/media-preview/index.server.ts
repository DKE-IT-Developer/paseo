import os from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { allowedRoots } from "./server/paths";
import { createReadHandlers } from "./server/read";
import { fileRead, fileStat } from "./shared/rpc";

const ROOTS_TTL_MS = 30_000;

type WorkspaceLister = Pick<PaseoApi, "workspaces">;

export default function contribute(server: PluginServerContext) {
  let cache: { at: number; roots: string[] } | null = null;

  async function rootsFor(paseo: WorkspaceLister): Promise<string[]> {
    const now = Date.now();
    if (cache && now - cache.at < ROOTS_TTL_MS) return cache.roots;
    const dirs: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await paseo.workspaces.list({
        filter: { includeBackground: true },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      for (const entry of result.entries) dirs.push(entry.workspaceDirectory);
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const roots = allowedRoots(dirs, os.homedir());
    cache = { at: now, roots };
    return roots;
  }

  server.handle(fileStat, (input, { paseo }) =>
    createReadHandlers(() => rootsFor(paseo)).stat(input),
  );
  server.handle(fileRead, (input, { paseo }) =>
    createReadHandlers(() => rootsFor(paseo)).read(input),
  );
  return () => {};
}

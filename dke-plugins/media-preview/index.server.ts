import os from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defaultCacheDir } from "./server/cache";
import { ConversionQueue, createConvertHandlers, createSofficeRunner } from "./server/convert";
import { allowedRoots, workspaceDirsFrom } from "./server/paths";
import { PREVIEW_OUTPUT, createFfmpegRunner, createPreviewHandlers } from "./server/preview";
import { createReadHandlers } from "./server/read";
import { CONVERT_TIMEOUT_MS, PREVIEW_TIMEOUT_MS } from "./shared/limits";
import {
  convertCancel,
  convertRead,
  convertStart,
  convertStatus,
  fileRead,
  fileStat,
  previewCancel,
  previewRead,
  previewStart,
  previewStatus,
} from "./shared/rpc";

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
      dirs.push(...workspaceDirsFrom(result.entries));
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const roots = allowedRoots(dirs, os.homedir());
    cache = { at: now, roots };
    return roots;
  }

  const cacheDir = defaultCacheDir();
  const queue = new ConversionQueue({
    cacheDir,
    runConverter: createSofficeRunner({ cacheDir }),
    timeoutMs: CONVERT_TIMEOUT_MS,
  });
  // Separate queue: one ffmpeg at a time, independent of soffice; same cache dir and pruning.
  const previewQueue = new ConversionQueue({
    cacheDir,
    runConverter: createFfmpegRunner(),
    timeoutMs: PREVIEW_TIMEOUT_MS,
    output: PREVIEW_OUTPUT,
  });

  server.handle(fileStat, (input, { paseo }) =>
    createReadHandlers(() => rootsFor(paseo)).stat(input),
  );
  server.handle(fileRead, (input, { paseo }) =>
    createReadHandlers(() => rootsFor(paseo)).read(input),
  );
  server.handle(convertStart, (input, { paseo }) =>
    createConvertHandlers(() => rootsFor(paseo), queue).start(input),
  );
  server.handle(convertStatus, (input, { paseo }) =>
    createConvertHandlers(() => rootsFor(paseo), queue).status(input),
  );
  server.handle(convertCancel, (input, { paseo }) =>
    createConvertHandlers(() => rootsFor(paseo), queue).cancel(input),
  );
  server.handle(convertRead, (input, { paseo }) =>
    createConvertHandlers(() => rootsFor(paseo), queue).read(input),
  );
  server.handle(previewStart, (input, { paseo }) =>
    createPreviewHandlers(() => rootsFor(paseo), previewQueue).start(input),
  );
  server.handle(previewStatus, (input, { paseo }) =>
    createPreviewHandlers(() => rootsFor(paseo), previewQueue).status(input),
  );
  server.handle(previewCancel, (input, { paseo }) =>
    createPreviewHandlers(() => rootsFor(paseo), previewQueue).cancel(input),
  );
  server.handle(previewRead, (input, { paseo }) =>
    createPreviewHandlers(() => rootsFor(paseo), previewQueue).read(input),
  );
  return () => {
    queue.dispose();
    previewQueue.dispose();
  };
}

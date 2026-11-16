import { describe, expect, it } from "vitest";
import { CHAT_CARD_MAX_BYTES, DIRECT_PLAY_MAX_BYTES } from "../../shared/limits";
import { TooLargeError, isAbortError } from "../read-chunks";
import {
  type PlayProgress,
  PlayController,
  type PlayRunDeps,
  chooseSource,
  runPlay,
} from "./play-run";

type JobState = "queued" | "running" | "done" | "error" | "cancelled";
const B64 = "AAAA"; // 3 bytes

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

interface Log {
  calls: string[];
  progress: PlayProgress[];
}

function makeDeps(over: Partial<PlayRunDeps> & { log: Log; statuses?: JobState[] }): PlayRunDeps {
  const { log, statuses = ["done"], ...rest } = over;
  let i = 0;
  return {
    path: "/klip.mp4",
    kind: "video",
    size: 3,
    mimeType: "video/quicktime",
    mode: "auto",
    rpc: {
      fileRead: async ({ offset }) => {
        log.calls.push(`fileRead:${offset}`);
        return { base64: B64, nextOffset: offset + 3, eof: true };
      },
      previewStart: async () => {
        log.calls.push("previewStart");
        return { jobId: "j1" };
      },
      previewStatus: async () => {
        const state = statuses[Math.min(i++, statuses.length - 1)];
        log.calls.push(`previewStatus:${state}`);
        return state === "done" ? { state, size: 3 } : { state };
      },
      previewRead: async ({ offset }) => {
        log.calls.push(`previewRead:${offset}`);
        return { base64: B64, nextOffset: offset + 3, eof: true };
      },
    },
    signal: new AbortController().signal,
    onProgress: (p) => log.progress.push(p),
    onJobId: () => {},
    onSettled: () => {},
    sleep: async () => {},
    pollMs: 1,
    ...rest,
  };
}

const newLog = (): Log => ({ calls: [], progress: [] });

describe("chooseSource", () => {
  it("plays files up to DIRECT_PLAY_MAX_BYTES directly, larger ones via preview", () => {
    expect(chooseSource(DIRECT_PLAY_MAX_BYTES, "auto")).toBe("original");
    expect(chooseSource(DIRECT_PLAY_MAX_BYTES + 1, "auto")).toBe("preview");
    expect(chooseSource(DIRECT_PLAY_MAX_BYTES + 1, "original")).toBe("original");
  });
});

describe("runPlay", () => {
  it("size ≤ 4 MB reads the original directly with progress", async () => {
    const log = newLog();
    const result = await runPlay(makeDeps({ log, size: 3 }));
    expect(log.calls).toEqual(["fileRead:0"]);
    expect(log.progress).toEqual([{ phase: "reading", read: 3, total: 3 }]);
    expect(result).toMatchObject({ mimeType: "video/quicktime", preview: false });
    expect(result.bytes.length).toBe(3);
  });

  it("size > 4 MB prepares a preview, polls, then reads it", async () => {
    const log = newLog();
    const jobIds: string[] = [];
    const result = await runPlay(
      makeDeps({
        log,
        size: DIRECT_PLAY_MAX_BYTES + 1,
        statuses: ["queued", "running", "done"],
        onJobId: (id) => jobIds.push(id),
      }),
    );
    expect(log.calls).toEqual([
      "previewStart",
      "previewStatus:queued",
      "previewStatus:running",
      "previewStatus:done",
      "previewRead:0",
    ]);
    expect(jobIds).toEqual(["j1"]);
    expect(log.progress).toEqual([{ phase: "preparing" }, { phase: "reading", read: 3, total: 3 }]);
    expect(result).toMatchObject({ mimeType: "video/mp4", preview: true });
  });

  it("audio preview is mp3", async () => {
    const log = newLog();
    const result = await runPlay(
      makeDeps({ log, kind: "audio", path: "/a.wav", size: DIRECT_PLAY_MAX_BYTES + 1 }),
    );
    expect(result).toMatchObject({ mimeType: "audio/mpeg", preview: true });
  });

  it("a failed preview job throws its error", async () => {
    const log = newLog();
    const deps = makeDeps({ log, size: DIRECT_PLAY_MAX_BYTES + 1 });
    deps.rpc.previewStatus = async () => ({ state: "error", error: "ffmpeg gagal (kode 1)" });
    await expect(runPlay(deps)).rejects.toThrow("ffmpeg gagal");
  });

  it("original quality of a file above CHAT_CARD_MAX_BYTES is refused without reading", async () => {
    const log = newLog();
    await expect(
      runPlay(makeDeps({ log, size: CHAT_CARD_MAX_BYTES + 1, mode: "original" })),
    ).rejects.toBeInstanceOf(TooLargeError);
    expect(log.calls).toEqual([]);
  });

  it("original quality between 4 MB and the card limit reads the original", async () => {
    const log = newLog();
    const result = await runPlay(
      makeDeps({ log, size: DIRECT_PLAY_MAX_BYTES + 1, mode: "original" }),
    );
    expect(log.calls).toEqual(["fileRead:0"]);
    expect(result.preview).toBe(false);
  });
});

describe("PlayController", () => {
  it("cancel while preparing sends an explicit cancel and aborts the run", async () => {
    const log = newLog();
    const sent: unknown[] = [];
    const controller = new PlayController(async (input) => {
      sent.push(input);
    });
    const status = deferred<{ state: JobState }>();
    const deps = makeDeps({
      log,
      size: DIRECT_PLAY_MAX_BYTES + 1,
      ...controller.hooks((p) => log.progress.push(p)),
    });
    deps.rpc.previewStatus = () => status.promise;
    const run = runPlay(deps).catch((e: unknown) => e);
    await flush();
    expect(log.progress).toEqual([{ phase: "preparing" }]);
    controller.cancel();
    expect(sent).toEqual([{ jobId: "j1" }]);
    expect(isAbortError(await run)).toBe(true);
    status.resolve({ state: "running" });
  });

  it("cancel before the jobId arrives is sent once start returns", async () => {
    const log = newLog();
    const sent: unknown[] = [];
    const controller = new PlayController(async (input) => {
      sent.push(input);
    });
    const started = deferred<{ jobId: string }>();
    const deps = makeDeps({
      log,
      size: DIRECT_PLAY_MAX_BYTES + 1,
      ...controller.hooks(() => {}),
    });
    deps.rpc.previewStart = () => started.promise;
    const run = runPlay(deps).catch((e: unknown) => e);
    await flush();
    controller.cancel();
    expect(sent).toEqual([]);
    started.resolve({ jobId: "j9" });
    expect(isAbortError(await run)).toBe(true);
    expect(sent).toEqual([{ jobId: "j9" }]);
  });

  it("cancel while reading aborts the read and sends no job cancel", async () => {
    const log = newLog();
    const sent: unknown[] = [];
    const controller = new PlayController(async (input) => {
      sent.push(input);
    });
    const deps = makeDeps({
      log,
      size: DIRECT_PLAY_MAX_BYTES + 1,
      ...controller.hooks((p) => log.progress.push(p)),
    });
    const second = deferred<never>();
    deps.rpc.previewRead = async ({ offset }) => {
      log.calls.push(`previewRead:${offset}`);
      if (offset === 0) return { base64: B64, nextOffset: 3, eof: false };
      return second.promise;
    };
    deps.rpc.previewStatus = async () => ({ state: "done", size: 6 });
    const run = runPlay(deps).catch((e: unknown) => e);
    await flush();
    expect(log.progress.at(-1)).toEqual({ phase: "reading", read: 3, total: 6 });
    controller.cancel();
    expect(isAbortError(await run)).toBe(true);
    expect(sent).toEqual([]);
    expect(log.calls).toEqual(["previewStart", "previewRead:0", "previewRead:3"]);
  });

  it("abandon (unmount) only drops a queued job", async () => {
    const log = newLog();
    const sent: unknown[] = [];
    const controller = new PlayController(async (input) => {
      sent.push(input);
    });
    const status = deferred<{ state: JobState }>();
    const deps = makeDeps({
      log,
      size: DIRECT_PLAY_MAX_BYTES + 1,
      ...controller.hooks(() => {}),
    });
    deps.rpc.previewStatus = () => status.promise;
    const run = runPlay(deps).catch((e: unknown) => e);
    await flush();
    controller.abandon();
    expect(sent).toEqual([{ jobId: "j1", onlyIfQueued: true }]);
    expect(isAbortError(await run)).toBe(true);
    status.resolve({ state: "queued" });
  });
});

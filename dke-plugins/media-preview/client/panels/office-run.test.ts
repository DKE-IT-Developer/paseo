import { describe, expect, it, vi } from "vitest";
import { type OfficeRunDeps, runOfficeConversion } from "./office-run";
import type { OfficeEvent } from "./office-state";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const B64 = "AAAA"; // 3 zero bytes

function makeDeps(over: Partial<OfficeRunDeps> & { events: OfficeEvent[] }): OfficeRunDeps {
  const { events, ...rest } = over;
  return {
    path: "/x.docx",
    maxBytes: 1000,
    rpc: {
      start: async () => ({ jobId: "j" }),
      status: async () => ({ state: "done", size: 3 }),
      read: async () => ({ base64: B64, nextOffset: 3, eof: true }),
    },
    dispatch: (e) => events.push(e),
    onJobId: () => {},
    onUrl: () => {},
    toBlobUrl: () => "blob:1",
    revokeBlobUrl: () => {},
    sleep: async () => {},
    pollMs: 1,
    ...rest,
  };
}

describe("runOfficeConversion", () => {
  it("completes: started, done, loaded", async () => {
    const events: OfficeEvent[] = [];
    const onUrl = vi.fn();
    await runOfficeConversion(makeDeps({ events, onUrl }), () => false);
    expect(events.map((e) => e.type)).toEqual(["started", "status", "loaded"]);
    expect(onUrl).toHaveBeenCalledWith("blob:1");
  });

  it("stale run cannot dispatch after a new run starts", async () => {
    const oldEvents: OfficeEvent[] = [];
    const newEvents: OfficeEvent[] = [];
    const gate = deferred<{ state: "cancelled" }>();
    let oldStopped = false;
    const oldRun = runOfficeConversion(
      makeDeps({
        events: oldEvents,
        rpc: {
          start: async () => ({ jobId: "old" }),
          status: () => gate.promise,
          read: async () => ({ base64: "", nextOffset: 0, eof: true }),
        },
      }),
      () => oldStopped,
    );
    await flush();
    // user cancels, retries: old run is stopped, new run starts with its own flag
    oldStopped = true;
    const newStopped = false;
    const newRun = runOfficeConversion(makeDeps({ events: newEvents }), () => newStopped);
    gate.resolve({ state: "cancelled" });
    await Promise.all([oldRun, newRun]);
    expect(oldEvents.map((e) => e.type)).toEqual(["started"]);
    expect(newEvents.map((e) => e.type)).toEqual(["started", "status", "loaded"]);
  });

  it("blob URL created after stop is revoked and not published", async () => {
    const events: OfficeEvent[] = [];
    const gate = deferred<void>();
    let stopped = false;
    const revoke = vi.fn();
    const onUrl = vi.fn();
    const run = runOfficeConversion(
      makeDeps({
        events,
        onUrl,
        revokeBlobUrl: revoke,
        rpc: {
          start: async () => ({ jobId: "j" }),
          status: async () => ({ state: "done", size: 3 }),
          read: async () => {
            await gate.promise;
            return { base64: B64, nextOffset: 3, eof: true };
          },
        },
      }),
      () => stopped,
    );
    await flush();
    stopped = true;
    gate.resolve();
    await run;
    expect(revoke).toHaveBeenCalledWith("blob:1");
    expect(onUrl).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["started", "status"]);
  });

  it("restarts once when status throws for an unknown job", async () => {
    const events: OfficeEvent[] = [];
    let calls = 0;
    const start = vi.fn(async () => ({ jobId: `j${++calls}` }));
    let first = true;
    await runOfficeConversion(
      makeDeps({
        events,
        rpc: {
          start,
          status: async () => {
            if (first) {
              first = false;
              throw new Error("unknown job");
            }
            return { state: "done", size: 3 };
          },
          read: async () => ({ base64: B64, nextOffset: 3, eof: true }),
        },
      }),
      () => false,
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.type).toBe("loaded");
  });
});

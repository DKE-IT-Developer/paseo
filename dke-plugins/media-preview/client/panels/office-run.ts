import { readAllChunks } from "../read-chunks";
import type { OfficeEvent } from "./office-state";

export const WEB_ONLY_MESSAGE = "Pratinjau dokumen hanya tersedia di web";

interface Chunk {
  base64: string;
  nextOffset: number;
  eof: boolean;
}

export interface OfficeRunDeps {
  path: string;
  maxBytes: number;
  rpc: {
    start: (input: { path: string }) => Promise<{ jobId: string }>;
    status: (input: { jobId: string }) => Promise<{
      state: "queued" | "running" | "done" | "error" | "cancelled";
      error?: string;
      size?: number;
    }>;
    read: (input: { jobId: string; offset: number }) => Promise<Chunk>;
  };
  dispatch: (event: OfficeEvent) => void;
  /** Called for every jobId the server returns, even after the run was stopped. */
  onJobId: (jobId: string) => void;
  /** Called once the job reached a terminal state (done, error, cancelled). */
  onSettled?: () => void;
  onUrl: (url: string) => void;
  toBlobUrl: (bytes: Uint8Array, mime: string) => string | null;
  revokeBlobUrl: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
}

export interface CancelInput {
  jobId: string;
  onlyIfQueued?: boolean;
}

/**
 * Delivers at most one cancel for a conversion run. "Batal" (`cancel`) cancels regardless of
 * state; leaving the panel (`abandon`) only drops a still-queued job, because a running job
 * may be shared with another panel and its PDF lands in the cache. An intent recorded before
 * `start` returned is sent as soon as the jobId arrives.
 */
export class JobCanceller {
  private jobId: string | null = null;
  private settled = false;
  private sent = false;
  private intent: { onlyIfQueued: boolean } | null = null;

  constructor(private readonly send: (input: CancelInput) => Promise<unknown>) {}

  jobStarted(jobId: string): void {
    this.jobId = jobId;
    this.settled = false;
    if (this.intent) this.fire(this.intent.onlyIfQueued);
  }

  jobSettled(): void {
    this.settled = true;
  }

  cancel(): void {
    this.request(false);
  }

  abandon(): void {
    this.request(true);
  }

  private request(onlyIfQueued: boolean): void {
    if (this.sent || this.intent) return;
    if (this.jobId === null) {
      this.intent = { onlyIfQueued };
      return;
    }
    if (onlyIfQueued && this.settled) return;
    this.fire(onlyIfQueued);
  }

  private fire(onlyIfQueued: boolean): void {
    if (this.sent || this.jobId === null) return;
    this.sent = true;
    this.intent = null;
    const input: CancelInput = onlyIfQueued
      ? { jobId: this.jobId, onlyIfQueued: true }
      : { jobId: this.jobId };
    void this.send(input).catch(() => undefined);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One conversion run. `isStopped` is owned by THIS run (never shared across runs): once it
 * returns true the run emits nothing further and revokes any blob URL it created.
 */
export async function runOfficeConversion(
  deps: OfficeRunDeps,
  isStopped: () => boolean,
): Promise<void> {
  const { rpc, path } = deps;
  const emit = (event: OfficeEvent) => {
    if (!isStopped()) deps.dispatch(event);
  };
  try {
    let { jobId } = await rpc.start({ path });
    // Report the jobId even when stopped, so a pending cancel can still reach the server.
    deps.onJobId(jobId);
    if (isStopped()) return;
    emit({ type: "started", jobId });
    let restarted = false;
    for (;;) {
      let st;
      try {
        st = await rpc.status({ jobId });
      } catch (error) {
        // Unknown jobId (e.g. daemon restarted) throws: start again once.
        if (restarted) throw error;
        restarted = true;
        if (isStopped()) return;
        ({ jobId } = await rpc.start({ path }));
        deps.onJobId(jobId);
        if (isStopped()) return;
        emit({ type: "started", jobId });
        continue;
      }
      if (st.state !== "queued" && st.state !== "running") deps.onSettled?.();
      if (isStopped()) return;
      emit({ type: "status", state: st.state, error: st.error });
      if (st.state === "done") {
        const finalJob = jobId;
        const bytes = await readAllChunks(
          (offset) => rpc.read({ jobId: finalJob, offset }),
          deps.maxBytes,
          st.size ?? 0,
        );
        const url = deps.toBlobUrl(bytes, "application/pdf");
        if (url === null) {
          emit({ type: "failed", message: WEB_ONLY_MESSAGE });
          return;
        }
        if (isStopped()) {
          deps.revokeBlobUrl(url);
          return;
        }
        deps.onUrl(url);
        emit({ type: "loaded" });
        return;
      }
      if (st.state !== "queued" && st.state !== "running") return;
      await deps.sleep(deps.pollMs);
      if (isStopped()) return;
    }
  } catch (error) {
    emit({ type: "failed", message: messageOf(error) });
  }
}

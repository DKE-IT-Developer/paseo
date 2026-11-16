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
  onJobId: (jobId: string) => void;
  onUrl: (url: string) => void;
  toBlobUrl: (bytes: Uint8Array, mime: string) => string | null;
  revokeBlobUrl: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
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
    if (isStopped()) return;
    deps.onJobId(jobId);
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
        if (isStopped()) return;
        deps.onJobId(jobId);
        emit({ type: "started", jobId });
        continue;
      }
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

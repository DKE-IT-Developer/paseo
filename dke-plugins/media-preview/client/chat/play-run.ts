import {
  CHAT_CARD_MAX_BYTES,
  DIRECT_PLAY_MAX_BYTES,
  PREVIEW_MAX_SECONDS_VIDEO,
} from "../../shared/limits";
import { type CancelInput, JobCanceller } from "../panels/office-run";
import { AbortedError, raceAbort, readAllChunks } from "../read-chunks";

export type PlayKind = "audio" | "video";
/** "auto" picks the preview for large files; "original" is "Putar kualitas asli". */
export type PlayMode = "auto" | "original";
export type PlaySource = "original" | "preview";
export type PlayProgress =
  | { phase: "preparing" }
  | { phase: "reading"; read: number; total: number };

interface Chunk {
  base64: string;
  nextOffset: number;
  eof: boolean;
}

type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface PlayRunDeps {
  path: string;
  kind: PlayKind;
  size: number;
  mimeType: string;
  mode: PlayMode;
  rpc: {
    fileRead: (input: { path: string; offset: number }) => Promise<Chunk>;
    previewStart: (input: { path: string }) => Promise<{ jobId: string }>;
    previewStatus: (input: {
      jobId: string;
    }) => Promise<{ state: JobState; error?: string; size?: number }>;
    previewRead: (input: { jobId: string; offset: number }) => Promise<Chunk>;
  };
  signal: AbortSignal;
  onProgress: (progress: PlayProgress) => void;
  /** Called for every jobId the server returns, even after abort, so a pending cancel lands. */
  onJobId: (jobId: string) => void;
  /** Called once the preview job reached a terminal state. */
  onSettled: () => void;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
}

export interface PlayResult {
  bytes: Uint8Array;
  mimeType: string;
  preview: boolean;
}

export function chooseSource(size: number, mode: PlayMode): PlaySource {
  return mode === "original" || size <= DIRECT_PLAY_MAX_BYTES ? "original" : "preview";
}

/** Meta text above a preview player; video previews are cut to the first minutes. */
export function previewLabel(kind: PlayKind): string {
  if (kind === "audio") return "Pratinjau";
  return `Pratinjau · maks. ${Math.round(PREVIEW_MAX_SECONDS_VIDEO / 60)} menit pertama`;
}

function previewMime(kind: PlayKind): string {
  return kind === "video" ? "video/mp4" : "audio/mpeg";
}

async function readOriginal(deps: PlayRunDeps): Promise<PlayResult> {
  const bytes = await readAllChunks(
    (offset) => deps.rpc.fileRead({ path: deps.path, offset }),
    CHAT_CARD_MAX_BYTES,
    deps.size,
    {
      signal: deps.signal,
      onProgress: (read, total) => deps.onProgress({ phase: "reading", read, total }),
    },
  );
  return { bytes, mimeType: deps.mimeType, preview: false };
}

async function preparePreview(deps: PlayRunDeps): Promise<{ jobId: string; size: number }> {
  const { rpc, signal } = deps;
  deps.onProgress({ phase: "preparing" });
  let { jobId } = await rpc.previewStart({ path: deps.path });
  deps.onJobId(jobId);
  let restarted = false;
  for (;;) {
    if (signal.aborted) throw new AbortedError();
    let st;
    try {
      st = await raceAbort(rpc.previewStatus({ jobId }), signal);
    } catch (error) {
      // Unknown jobId (daemon restarted) throws: start again once.
      if (signal.aborted || restarted) throw error;
      restarted = true;
      ({ jobId } = await rpc.previewStart({ path: deps.path }));
      deps.onJobId(jobId);
      continue;
    }
    if (st.state !== "queued" && st.state !== "running") deps.onSettled();
    if (st.state === "done") return { jobId, size: st.size ?? 0 };
    if (st.state === "cancelled") throw new AbortedError();
    if (st.state === "error") throw new Error(st.error ?? "Pratinjau gagal dibuat");
    await raceAbort(deps.sleep(deps.pollMs), signal);
  }
}

/**
 * One play attempt for a chat card: the original file for small files (or "kualitas asli"),
 * otherwise a server-side preview job. Rejects with AbortedError when `signal` aborts.
 */
export async function runPlay(deps: PlayRunDeps): Promise<PlayResult> {
  if (deps.signal.aborted) throw new AbortedError();
  if (chooseSource(deps.size, deps.mode) === "original") return readOriginal(deps);
  const { jobId, size } = await preparePreview(deps);
  const bytes = await readAllChunks(
    (offset) => deps.rpc.previewRead({ jobId, offset }),
    CHAT_CARD_MAX_BYTES,
    size,
    {
      signal: deps.signal,
      onProgress: (read, total) => deps.onProgress({ phase: "reading", read, total }),
    },
  );
  return { bytes, mimeType: previewMime(deps.kind), preview: true };
}

/**
 * Owns the stop controls of one play attempt. "Batal" while the preview is being prepared
 * cancels the job explicitly; while reading it only aborts (the finished preview stays cached).
 * Unmount (`abandon`) drops the job only while it is queued, like the office panel.
 */
export class PlayController {
  private readonly abort = new AbortController();
  private readonly canceller: JobCanceller;
  private phase: PlayProgress["phase"] | null = null;

  constructor(send: (input: CancelInput) => Promise<unknown>) {
    this.canceller = new JobCanceller(send);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** The runPlay deps this controller owns; `onProgress` is forwarded after tracking. */
  hooks(
    onProgress: (progress: PlayProgress) => void,
  ): Pick<PlayRunDeps, "signal" | "onProgress" | "onJobId" | "onSettled"> {
    return {
      signal: this.abort.signal,
      onProgress: (progress) => {
        this.phase = progress.phase;
        onProgress(progress);
      },
      onJobId: (jobId) => this.canceller.jobStarted(jobId),
      onSettled: () => this.canceller.jobSettled(),
    };
  }

  cancel(): void {
    if (this.phase === "preparing") this.canceller.cancel();
    this.abort.abort();
  }

  abandon(): void {
    this.canceller.abandon();
    this.abort.abort();
  }
}

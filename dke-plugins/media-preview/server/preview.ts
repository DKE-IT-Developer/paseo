import { access } from "node:fs/promises";
import path from "node:path";
import { fileKind } from "../shared/kinds";
import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_SECONDS_AUDIO,
  PREVIEW_MAX_SECONDS_VIDEO,
} from "../shared/limits";
import {
  type ConversionQueue,
  type Converter,
  type QueueOutput,
  createJobHandlers,
  runNicedDetached,
} from "./convert";

export const FFMPEG_BIN = "/opt/homebrew/bin/ffmpeg";

export class NotPreviewableError extends Error {
  constructor() {
    super("Hanya audio atau video yang bisa dibuat pratinjaunya");
    this.name = "NotPreviewableError";
  }
}

/** Video previews are mp4 (H.264/AAC), audio previews mp3. */
export function previewExt(input: string): "mp4" | "mp3" {
  const kind = fileKind(input);
  if (kind === "video") return "mp4";
  if (kind === "audio") return "mp3";
  throw new NotPreviewableError();
}

export const PREVIEW_OUTPUT: QueueOutput = {
  suffix: (input) => `.preview.${previewExt(input)}`,
  find: async (outDir, input) => {
    const file = path.join(outDir, `preview.${previewExt(input)}`);
    try {
      await access(file);
      return file;
    } catch {
      return null;
    }
  },
  // Keeps preview keys apart from the PDF key of the same file.
  keySalt: "preview",
  label: "berkas pratinjau",
};

function ffmpegArgs(input: string, output: string): string[] {
  const audio = previewExt(input) === "mp3";
  const seconds = audio ? PREVIEW_MAX_SECONDS_AUDIO : PREVIEW_MAX_SECONDS_VIDEO;
  // Input-side -t: only the first part is decoded. `file:` stops ffmpeg from reading a path
  // as a protocol URL.
  const head = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(seconds),
    "-i",
    `file:${input}`,
  ];
  const tail = ["-y", `file:${output}`];
  if (audio) {
    return [...head, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", ...tail];
  }
  return [
    ...head,
    // Capital V skips attached pictures (cover art) and "?" allows audio-only "video" files;
    // both then produce an AAC-only mp4.
    "-map",
    "0:V:0?",
    "-map",
    "0:a:0?",
    // -2 keeps the width even; the height is rounded down to even too (yuv420p needs both).
    "-vf",
    `scale=-2:'min(${PREVIEW_MAX_HEIGHT},trunc(ih/2)*2)'`,
    "-c:v",
    "libx264",
    // Leaves cores for the shared Mac's real-time services.
    "-threads",
    "2",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-maxrate",
    "1M",
    "-bufsize",
    "2M",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    ...tail,
  ];
}

/** Writes `<outDir>/preview.mp4|mp3`; the queue renames it into the cache on success. */
export function createFfmpegRunner(opts: { binary?: string } = {}): Converter {
  const binary = opts.binary ?? FFMPEG_BIN;
  return async (input, outDir, signal) => {
    const output = path.join(outDir, `preview.${previewExt(input)}`);
    const stderr = await runNicedDetached(binary, ffmpegArgs(input, output), signal, "ffmpeg");
    if (!(await PREVIEW_OUTPUT.find(outDir, input))) {
      throw new Error(`ffmpeg tidak menghasilkan pratinjau: ${stderr}`);
    }
  };
}

export function createPreviewHandlers(getRoots: () => Promise<string[]>, queue: ConversionQueue) {
  return createJobHandlers(getRoots, queue, (real) => {
    const kind = fileKind(real);
    if (kind !== "audio" && kind !== "video") throw new NotPreviewableError();
  });
}

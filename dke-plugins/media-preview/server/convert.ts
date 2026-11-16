import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileKind } from "../shared/kinds";
import { CACHE_MAX_BYTES } from "../shared/limits";
import { cacheKey, defaultCacheDir, pruneCache } from "./cache";
import { resolveAllowedPath } from "./paths";
import { NotRegularFileError, readFileChunk } from "./read";

export const SOFFICE_BIN = "/opt/homebrew/bin/soffice";
const NICE_BIN = "/usr/bin/nice";
const STDERR_MAX_CHARS = 4_000;

export type ConvertState = "queued" | "running" | "done" | "error" | "cancelled";
export interface ConvertStatus {
  state: ConvertState;
  error?: string;
  size?: number;
}
export type Converter = (input: string, outDir: string, signal: AbortSignal) => Promise<void>;

export class UnknownJobError extends Error {
  constructor() {
    super("Job konversi tidak dikenal; mulai ulang konversi");
    this.name = "UnknownJobError";
  }
}

export class NotConvertibleError extends Error {
  constructor() {
    super("Hanya dokumen office atau sheet yang bisa dikonversi");
    this.name = "NotConvertibleError";
  }
}

/** Re-validates a queued input right before conversion; returns the path to convert. */
export type InputCheck = (input: string) => Promise<string>;

interface Job {
  input: string;
  recheck?: InputCheck;
  state: ConvertState;
  error?: string;
  size?: number;
  controller?: AbortController;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * soffice names its output `<basename without extension>.pdf`. Fall back to the
 * only PDF in the directory in case the name was normalised differently (NFC/NFD).
 */
export async function findPdf(outDir: string, input: string): Promise<string | null> {
  const expected = path.join(outDir, `${path.parse(input).name}.pdf`);
  if (await exists(expected)) return expected;
  const pdfs = (await readdir(outDir)).filter((name) => name.toLowerCase().endsWith(".pdf"));
  return pdfs.length === 1 ? path.join(outDir, pdfs[0]) : null;
}

/**
 * Starts `work` unless already aborted, and rejects as soon as `signal`
 * aborts even if the converter ignores the signal.
 */
function runAbortable(work: () => Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Konversi dihentikan"));
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Konversi dihentikan"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work(), aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort),
  );
}

export class ConversionQueue {
  private readonly cacheDir: string;
  private readonly runConverter: Converter;
  private readonly timeoutMs: number;
  private readonly maxCacheBytes: number;
  private readonly jobs = new Map<string, Job>();
  private readonly pending: string[] = [];
  private running = false;
  private disposed = false;

  constructor(opts: {
    cacheDir: string;
    runConverter: Converter;
    timeoutMs: number;
    maxCacheBytes?: number;
  }) {
    this.cacheDir = opts.cacheDir;
    this.runConverter = opts.runConverter;
    this.timeoutMs = opts.timeoutMs;
    this.maxCacheBytes = opts.maxCacheBytes ?? CACHE_MAX_BYTES;
  }

  private cachedPdf(key: string): string {
    return path.join(this.cacheDir, `${key}.pdf`);
  }

  private activeJob(key: string): boolean {
    const state = this.jobs.get(key)?.state;
    return state === "queued" || state === "running";
  }

  async start(
    realPath: string,
    opts: { recheck?: InputCheck } = {},
  ): Promise<{ jobId: string; cached: boolean }> {
    const info = await stat(realPath);
    if (!info.isFile()) throw new NotRegularFileError();
    const key = cacheKey(realPath, info.size, info.mtimeMs);
    if (this.activeJob(key)) return { jobId: key, cached: false };

    const pdf = this.cachedPdf(key);
    let cachedSize: number | null = null;
    try {
      const cached = await stat(pdf);
      if (cached.isFile()) {
        cachedSize = cached.size;
        // Mark as recently used so pruneCache evicts it last.
        await utimes(pdf, new Date(), cached.mtime).catch(() => {});
      }
    } catch {
      cachedSize = null;
    }

    // Re-check after the awaits: a concurrent start may have queued the job.
    if (this.activeJob(key)) return { jobId: key, cached: false };
    if (cachedSize !== null) {
      this.jobs.set(key, { input: realPath, state: "done", size: cachedSize });
      return { jobId: key, cached: true };
    }
    this.jobs.set(key, {
      input: realPath,
      state: "queued",
      ...(opts.recheck ? { recheck: opts.recheck } : {}),
    });
    this.pending.push(key);
    void this.pump();
    return { jobId: key, cached: false };
  }

  status(jobId: string): ConvertStatus {
    const job = this.jobs.get(jobId);
    if (!job) throw new UnknownJobError();
    const out: ConvertStatus = { state: job.state };
    if (job.error !== undefined) out.error = job.error;
    if (job.size !== undefined) out.size = job.size;
    return out;
  }

  /**
   * `onlyIfQueued` (sent when a panel is abandoned) leaves a running job alone: jobs are
   * deduped per file, so another panel may be waiting for it, and its PDF lands in the cache.
   */
  cancel(jobId: string, opts: { onlyIfQueued?: boolean } = {}): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (opts.onlyIfQueued && job.state !== "queued") return;
    if (job.state === "queued") {
      job.state = "cancelled";
      const index = this.pending.indexOf(jobId);
      if (index >= 0) this.pending.splice(index, 1);
    } else if (job.state === "running") {
      job.state = "cancelled";
      job.controller?.abort("cancel");
    }
  }

  pdfPath(jobId: string): string {
    const job = this.jobs.get(jobId);
    if (!job) throw new UnknownJobError();
    if (job.state !== "done") throw new Error("Konversi belum selesai");
    return this.cachedPdf(jobId);
  }

  /** Aborts the running conversion and drops queued ones (plugin unload). */
  dispose(): void {
    this.disposed = true;
    for (const key of this.pending.splice(0)) this.cancel(key);
    for (const [key, job] of this.jobs) if (job.state === "running") this.cancel(key);
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    const key = this.pending.shift();
    if (key === undefined) return;
    const job = this.jobs.get(key);
    if (!job || job.state !== "queued") return this.pump();

    this.running = true;
    job.state = "running";
    const controller = new AbortController();
    job.controller = controller;
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    let outDir: string | undefined;
    try {
      // The file may have changed while queued (e.g. swapped for a symlink out of the
      // allowed roots): validate again right before handing it to soffice.
      const input = job.recheck ? await job.recheck(job.input) : job.input;
      await mkdir(this.cacheDir, { recursive: true });
      outDir = await mkdtemp(path.join(this.cacheDir, "tmp-"));
      const dir = outDir;
      await runAbortable(() => this.runConverter(input, dir, controller.signal), controller.signal);
      const produced = await findPdf(outDir, input);
      if (!produced) throw new Error("Konversi selesai tanpa berkas PDF");
      const target = this.cachedPdf(key);
      await rename(produced, target);
      const size = (await stat(target)).size;
      if (job.state === "running") {
        job.state = "done";
        job.size = size;
      }
      // Prune only after the new PDF is in place, and never the new PDF itself.
      await pruneCache(this.cacheDir, this.maxCacheBytes, [`${key}.pdf`]).catch(() => {});
    } catch (error) {
      if (job.state === "running") {
        job.state = "error";
        job.error =
          controller.signal.reason === "timeout"
            ? `Konversi melewati batas waktu (${this.timeoutMs / 1000} s)`
            : errorMessage(error);
      }
    } finally {
      clearTimeout(timer);
      job.controller = undefined;
      if (outDir) await rm(outDir, { recursive: true, force: true }).catch(() => {});
      this.running = false;
      void this.pump();
    }
  }
}

/**
 * Runs `nice -n 10 soffice --headless --convert-to pdf` in its own process
 * group (detached) so abort can SIGKILL soffice and every helper it spawned.
 * A private -env:UserInstallation profile keeps headless conversion working
 * while a LibreOffice GUI instance is open.
 */
export function createSofficeRunner(opts: { cacheDir: string; binary?: string }): Converter {
  const binary = opts.binary ?? SOFFICE_BIN;
  const profileUrl = pathToFileURL(path.join(opts.cacheDir, "lo-profile")).href;
  return (input, outDir, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Konversi dihentikan"));
      const child = spawn(
        NICE_BIN,
        [
          "-n",
          "10",
          binary,
          "--headless",
          `-env:UserInstallation=${profileUrl}`,
          "--convert-to",
          "pdf",
          "--outdir",
          outDir,
          input,
        ],
        { detached: true, stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // Group already gone.
          }
        }
        finish(new Error("Konversi dihentikan"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => {
        stderr = (stderr + data).slice(-STDERR_MAX_CHARS);
      });
      child.on("error", (error) => finish(error));
      child.on("close", (code, sig) => {
        if (settled) return;
        if (code !== 0) {
          finish(new Error(`soffice gagal (kode ${code ?? sig}): ${stderr.trim()}`));
          return;
        }
        findPdf(outDir, input).then(
          (pdf) =>
            finish(pdf ? undefined : new Error(`soffice tidak menghasilkan PDF: ${stderr.trim()}`)),
          (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
        );
      });
    });
}

export const runSoffice: Converter = (input, outDir, signal) =>
  createSofficeRunner({ cacheDir: defaultCacheDir() })(input, outDir, signal);

export function createConvertHandlers(getRoots: () => Promise<string[]>, queue: ConversionQueue) {
  return {
    async start({ path: target }: { path: string }) {
      const allowed = async (candidate: string): Promise<string> => {
        const real = await resolveAllowedPath(candidate, await getRoots());
        const kind = fileKind(real);
        if (kind !== "office" && kind !== "sheet") throw new NotConvertibleError();
        return real;
      };
      return queue.start(await allowed(target), { recheck: allowed });
    },
    status({ jobId }: { jobId: string }): ConvertStatus {
      return queue.status(jobId);
    },
    cancel({
      jobId,
      onlyIfQueued,
    }: {
      jobId: string;
      onlyIfQueued?: boolean;
    }): Record<string, never> {
      queue.cancel(jobId, { onlyIfQueued: onlyIfQueued === true });
      return {};
    },
    async read({ jobId, offset }: { jobId: string; offset: number }) {
      const pdf = queue.pdfPath(jobId);
      try {
        return await readFileChunk(pdf, offset);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("Hasil konversi sudah tidak ada di cache; mulai ulang konversi", {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}

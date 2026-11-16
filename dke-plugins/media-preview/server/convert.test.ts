import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversionQueue,
  UnknownJobError,
  createConvertHandlers,
  createSofficeRunner,
} from "./convert";

type Converter = (input: string, outDir: string, signal: AbortSignal) => Promise<void>;

let base: string;
let root: string;
let cacheDir: string;
const queues: ConversionQueue[] = [];

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "dke-convert-")));
  root = path.join(base, "root");
  cacheDir = path.join(base, "cache");
  await mkdir(root);
});

afterEach(async () => {
  for (const q of queues.splice(0)) q.dispose();
  await rm(base, { recursive: true, force: true });
});

function makeQueue(
  runConverter: Converter,
  extra: { timeoutMs?: number; maxCacheBytes?: number } = {},
) {
  const q = new ConversionQueue({
    cacheDir,
    runConverter,
    timeoutMs: extra.timeoutMs ?? 5_000,
    ...(extra.maxCacheBytes !== undefined ? { maxCacheBytes: extra.maxCacheBytes } : {}),
  });
  queues.push(q);
  return q;
}

const writesPdf: Converter = async (input, outDir) => {
  await writeFile(path.join(outDir, `${path.parse(input).name}.pdf`), "%PDF-1.4 dummy");
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function abortable(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

async function doc(name: string, content = "isi"): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, content);
  return file;
}

async function waitState(q: ConversionQueue, jobId: string, state: string) {
  await vi.waitFor(() => expect(q.status(jobId).state).toBe(state), {
    timeout: 2_000,
    interval: 5,
  });
}

describe("ConversionQueue", () => {
  it("cache hit returns cached true without running converter", async () => {
    const file = await doc("a.docx");
    const first = vi.fn(writesPdf);
    const q1 = makeQueue(first);
    const r1 = await q1.start(file);
    expect(r1.cached).toBe(false);
    await waitState(q1, r1.jobId, "done");
    expect(first).toHaveBeenCalledTimes(1);

    // New queue = daemon restart: jobs map empty, cache on disk.
    const second = vi.fn(writesPdf);
    const q2 = makeQueue(second);
    const r2 = await q2.start(file);
    expect(r2).toEqual({ jobId: r1.jobId, cached: true });
    expect(q2.status(r2.jobId)).toEqual({ state: "done", size: 14 });
    expect(second).not.toHaveBeenCalled();
  });

  it("dedupes concurrent jobs", async () => {
    const file = await doc("deck.pptx");
    const g = gate();
    const converter = vi.fn<Converter>(async (input, outDir) => {
      await g.promise;
      await writesPdf(input, outDir, new AbortController().signal);
    });
    const q = makeQueue(converter);
    const [a, b] = await Promise.all([q.start(file), q.start(file)]);
    expect(a.jobId).toBe(b.jobId);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    const c = await q.start(file);
    expect(c.jobId).toBe(a.jobId);
    g.release();
    await waitState(q, a.jobId, "done");
    expect(converter).toHaveBeenCalledTimes(1);
  });

  it("cache key changes with mtime", async () => {
    const file = await doc("a.docx");
    const converter = vi.fn(writesPdf);
    const q = makeQueue(converter);
    const r1 = await q.start(file);
    await waitState(q, r1.jobId, "done");
    await utimes(file, new Date(), new Date(Date.now() + 10_000));
    const r2 = await q.start(file);
    expect(r2.jobId).not.toBe(r1.jobId);
    expect(r2.cached).toBe(false);
    await waitState(q, r2.jobId, "done");
    expect(converter).toHaveBeenCalledTimes(2);
  });

  it("runs one conversion at a time", async () => {
    const a = await doc("a.docx");
    const b = await doc("b.docx");
    const gates = [gate(), gate()];
    let active = 0;
    let maxActive = 0;
    let call = 0;
    const q = makeQueue(async (input, outDir, signal) => {
      const g = gates[call++];
      active++;
      maxActive = Math.max(maxActive, active);
      await g.promise;
      active--;
      await writesPdf(input, outDir, signal);
    });
    const ja = await q.start(a);
    const jb = await q.start(b);
    await waitState(q, ja.jobId, "running");
    expect(q.status(jb.jobId).state).toBe("queued");
    gates[0].release();
    await waitState(q, jb.jobId, "running");
    expect(q.status(ja.jobId).state).toBe("done");
    gates[1].release();
    await waitState(q, jb.jobId, "done");
    expect(maxActive).toBe(1);
  });

  it("timeout kills process", async () => {
    const file = await doc("hang.docx");
    let seen: AbortSignal | null = null;
    const q = makeQueue(
      (_input, _outDir, signal) => {
        seen = signal;
        return abortable(signal);
      },
      { timeoutMs: 50 },
    );
    const { jobId } = await q.start(file);
    await waitState(q, jobId, "error");
    expect(q.status(jobId).error).toMatch(/batas waktu/);
    expect(seen).not.toBeNull();
    expect(seen!.aborted).toBe(true);
  });

  it("cancel aborts running job", async () => {
    const a = await doc("a.docx");
    const b = await doc("b.docx");
    let seen: AbortSignal | null = null;
    const converter = vi.fn<Converter>((_input, _outDir, signal) => {
      seen = signal;
      return abortable(signal);
    });
    const q = makeQueue(converter);
    const ja = await q.start(a);
    const jb = await q.start(b);
    await vi.waitFor(() => expect(converter).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
      interval: 5,
    });
    expect(q.status(ja.jobId).state).toBe("running");
    q.cancel(jb.jobId);
    expect(q.status(jb.jobId).state).toBe("cancelled");
    q.cancel(ja.jobId);
    expect(q.status(ja.jobId).state).toBe("cancelled");
    expect(seen!.aborted).toBe(true);
    // Queued job b never ran.
    await new Promise((r) => setTimeout(r, 20));
    expect(converter).toHaveBeenCalledTimes(1);
    // A cancelled job can be restarted.
    const again = makeQueue(writesPdf);
    const r = await again.start(a);
    await waitState(again, r.jobId, "done");
  });

  it("cancel with onlyIfQueued leaves a running job running and cancels a queued one", async () => {
    const a = await doc("a.docx");
    const b = await doc("b.docx");
    const release = gate();
    const converter = vi.fn<Converter>(async (input, outDir) => {
      await release.promise;
      await writesPdf(input, outDir, new AbortController().signal);
    });
    const q = makeQueue(converter);
    const ja = await q.start(a);
    const jb = await q.start(b);
    await waitState(q, ja.jobId, "running");
    q.cancel(ja.jobId, { onlyIfQueued: true });
    q.cancel(jb.jobId, { onlyIfQueued: true });
    expect(q.status(ja.jobId).state).toBe("running");
    expect(q.status(jb.jobId).state).toBe("cancelled");
    release.release();
    await waitState(q, ja.jobId, "done");
    await new Promise((r) => setTimeout(r, 20));
    expect(converter).toHaveBeenCalledTimes(1);
  });

  it("cancel during setup never starts the converter", async () => {
    const file = await doc("a.docx");
    const converter = vi.fn(writesPdf);
    const q = makeQueue(converter);
    const { jobId } = await q.start(file);
    q.cancel(jobId);
    await new Promise((r) => setTimeout(r, 30));
    expect(q.status(jobId).state).toBe("cancelled");
    expect(converter).not.toHaveBeenCalled();
  });

  it("reports converter failure", async () => {
    const file = await doc("rusak.docx");
    const q = makeQueue(async () => {
      throw new Error("soffice gagal (kode 1): Error: source file could not be loaded");
    });
    const { jobId } = await q.start(file);
    await waitState(q, jobId, "error");
    expect(q.status(jobId).error).toContain("source file could not be loaded");
    // Failed job can be retried.
    const r = await q.start(file);
    expect(r.cached).toBe(false);
  });

  it("reports error when converter produces no pdf", async () => {
    const file = await doc("kosong.docx");
    const q = makeQueue(async () => {});
    const { jobId } = await q.start(file);
    await waitState(q, jobId, "error");
    expect(q.status(jobId).error).toMatch(/PDF/);
  });

  it("finds output for names with spaces, parentheses and unicode", async () => {
    const file = await doc("Laporan Q3 (rev) é.docx");
    const q = makeQueue(writesPdf);
    const { jobId } = await q.start(file);
    await waitState(q, jobId, "done");
    expect((await readFile(q.pdfPath(jobId))).toString()).toBe("%PDF-1.4 dummy");
  });

  it("keeps the just-converted pdf even when it alone exceeds the cache limit", async () => {
    const a = await doc("a.docx");
    const b = await doc("b.docx");
    const q = makeQueue(writesPdf, { maxCacheBytes: 1 });
    const ja = await q.start(a);
    await waitState(q, ja.jobId, "done");
    const jb = await q.start(b);
    await waitState(q, jb.jobId, "done");
    const pdfs = (await readdir(cacheDir)).filter((n) => n.endsWith(".pdf"));
    expect(pdfs).toEqual([`${jb.jobId}.pdf`]);
    // a's pdf was pruned: start converts again instead of returning a stale job.
    const again = await q.start(a);
    expect(again.cached).toBe(false);
  });

  it("status of unknown job throws a clear error", () => {
    const q = makeQueue(writesPdf);
    expect(() => q.status("f".repeat(64))).toThrow(UnknownJobError);
    expect(() => q.pdfPath("../../etc/passwd")).toThrow(UnknownJobError);
  });
});

describe("createConvertHandlers", () => {
  it("accepts office and sheet files only", async () => {
    const q = makeQueue(writesPdf);
    const h = createConvertHandlers(async () => [root], q);
    for (const name of ["a.mp3", "b.pdf", "c.txt"]) {
      const file = await doc(name);
      await expect(h.start({ path: file })).rejects.toThrow("Hanya dokumen office atau sheet");
    }
    const sheet = await doc("data.xlsx");
    const r = await h.start({ path: sheet });
    await waitState(q, r.jobId, "done");
  });

  it("rejects paths outside roots", async () => {
    const q = makeQueue(writesPdf);
    const h = createConvertHandlers(async () => [root], q);
    const outside = path.join(base, "x.docx");
    await writeFile(outside, "x");
    await expect(h.start({ path: outside })).rejects.toThrow("Path tidak diizinkan");
  });

  it("read returns the pdf in fileRead chunk shape", async () => {
    const q = makeQueue(writesPdf);
    const h = createConvertHandlers(async () => [root], q);
    const file = await doc("a.docx");
    const { jobId } = await h.start({ path: file });
    await waitState(q, jobId, "done");
    const chunk = await h.read({ jobId, offset: 0 });
    expect(Buffer.from(chunk.base64, "base64").toString()).toBe("%PDF-1.4 dummy");
    expect(chunk).toMatchObject({ nextOffset: 14, eof: true });
    expect(h.status({ jobId })).toEqual({ state: "done", size: 14 });
    expect(h.cancel({ jobId })).toEqual({});
    expect(h.cancel({ jobId, onlyIfQueued: true })).toEqual({});
  });

  it("read of unknown or unfinished job throws", async () => {
    const q = makeQueue((_i, _o, signal) => abortable(signal));
    const h = createConvertHandlers(async () => [root], q);
    await expect(h.read({ jobId: "abc", offset: 0 })).rejects.toThrow(UnknownJobError);
    const file = await doc("a.docx");
    const { jobId } = await h.start({ path: file });
    await expect(h.read({ jobId, offset: 0 })).rejects.toThrow("belum selesai");
  });
});

describe("createSofficeRunner (fake binary)", () => {
  async function fakeBinary(body: string): Promise<string> {
    const bin = path.join(base, "fake-soffice.sh");
    await writeFile(bin, `#!/bin/sh\n${body}\n`);
    await chmod(bin, 0o755);
    return bin;
  }

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("passes soffice arguments and succeeds when the pdf exists", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await fakeBinary(
      `printf '%s\\n' "$@" > '${argsFile}'\n` +
        `while [ "$1" != "--outdir" ]; do shift; done\nout="$2"; shift 2\n` +
        `name=$(basename "$1"); printf '%%PDF' > "$out/\${name%.*}.pdf"`,
    );
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await doc("Laporan Q3 (rev).docx");
    await createSofficeRunner({ cacheDir, binary: bin })(
      input,
      outDir,
      new AbortController().signal,
    );
    expect(await readdir(outDir)).toEqual(["Laporan Q3 (rev).pdf"]);
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toEqual([
      "--headless",
      `-env:UserInstallation=file://${cacheDir}/lo-profile`,
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      input,
    ]);
  });

  it("fails with stderr when exit code is non-zero", async () => {
    const bin = await fakeBinary(`echo "Error: source file could not be loaded" >&2\nexit 3`);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await doc("rusak.docx");
    await expect(
      createSofficeRunner({ cacheDir, binary: bin })(input, outDir, new AbortController().signal),
    ).rejects.toThrow(/kode 3.*source file could not be loaded/s);
  });

  it("fails when exit is zero but no pdf was written", async () => {
    const bin = await fakeBinary(`echo "no export filter" >&2\nexit 0`);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await doc("a.docx");
    await expect(
      createSofficeRunner({ cacheDir, binary: bin })(input, outDir, new AbortController().signal),
    ).rejects.toThrow(/PDF.*no export filter/s);
  });

  it("abort kills the whole process group", async () => {
    const pidFile = path.join(base, "child.pid");
    const bin = await fakeBinary(`sleep 30 &\necho $! > '${pidFile}'\nwait`);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await doc("a.docx");
    const controller = new AbortController();
    const run = createSofficeRunner({ cacheDir, binary: bin })(input, outDir, controller.signal);
    run.catch(() => {});
    await vi.waitFor(async () => expect((await readFile(pidFile, "utf8")).trim()).not.toBe(""), {
      timeout: 2_000,
      interval: 10,
    });
    const grandchild = Number((await readFile(pidFile, "utf8")).trim());
    expect(alive(grandchild)).toBe(true);
    controller.abort("cancel");
    await expect(run).rejects.toThrow();
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 2_000, interval: 10 });
  });
});

describe.skipIf(process.env.RUN_SOFFICE !== "1")("soffice integration", () => {
  it("converts file with spaces", { timeout: 120_000 }, async () => {
    const work = path.join(base, "work");
    await mkdir(work);
    const txt = path.join(work, "Laporan Q3 (rev).txt");
    await writeFile(txt, "Laporan kuartal tiga\nRevisi pertama\n");
    const profile = `-env:UserInstallation=file://${cacheDir}/lo-profile`;
    execFileSync(
      "nice",
      [
        "-n",
        "10",
        "/opt/homebrew/bin/soffice",
        "--headless",
        profile,
        "--convert-to",
        "docx",
        "--outdir",
        root,
        txt,
      ],
      { stdio: "ignore", timeout: 90_000 },
    );
    const docx = path.join(root, "Laporan Q3 (rev).docx");
    const q = makeQueue(createSofficeRunner({ cacheDir }), { timeoutMs: 90_000 });
    const { jobId } = await q.start(docx);
    await vi.waitFor(() => expect(q.status(jobId).state).not.toMatch(/queued|running/), {
      timeout: 100_000,
      interval: 200,
    });
    expect(q.status(jobId)).toMatchObject({ state: "done" });
    const pdf = await readFile(q.pdfPath(jobId));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

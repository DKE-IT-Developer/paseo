import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_SECONDS_AUDIO,
  PREVIEW_MAX_SECONDS_VIDEO,
} from "../shared/limits";
import { cacheKey } from "./cache";
import { ConversionQueue, type Converter } from "./convert";
import { PREVIEW_OUTPUT, createFfmpegRunner, createPreviewHandlers, previewExt } from "./preview";

let base: string;
let root: string;
let cacheDir: string;
const queues: ConversionQueue[] = [];

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "dke-preview-")));
  root = path.join(base, "root");
  cacheDir = path.join(base, "cache");
  await mkdir(root);
});

afterEach(async () => {
  for (const q of queues.splice(0)) q.dispose();
  await rm(base, { recursive: true, force: true });
});

function makeQueue(runConverter: Converter, timeoutMs = 5_000) {
  const q = new ConversionQueue({ cacheDir, runConverter, timeoutMs, output: PREVIEW_OUTPUT });
  queues.push(q);
  return q;
}

/** Fake converter: writes `preview.<ext>` the way the ffmpeg runner does. */
const writesPreview: Converter = async (input, outDir) => {
  await writeFile(path.join(outDir, `preview.${previewExt(input)}`), "preview-bytes");
};

async function media(name: string, content = "isi"): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, content);
  return file;
}

async function waitState(q: ConversionQueue, jobId: string, state: string, timeout = 2_000) {
  await vi.waitFor(() => expect(q.status(jobId).state).toBe(state), { timeout, interval: 5 });
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("ConversionQueue with preview output", () => {
  it("stores the result as <key>.preview.mp4 for video and <key>.preview.mp3 for audio", async () => {
    const q = makeQueue(writesPreview);
    const video = await media("klip.mov");
    const audio = await media("rekaman.wav");
    const jv = await q.start(video);
    const ja = await q.start(audio);
    await waitState(q, jv.jobId, "done");
    await waitState(q, ja.jobId, "done");
    expect((await readdir(cacheDir)).filter((n) => !n.startsWith("tmp-")).sort()).toEqual(
      [`${ja.jobId}.preview.mp3`, `${jv.jobId}.preview.mp4`].sort(),
    );
    expect(q.outputPath(jv.jobId)).toBe(path.join(cacheDir, `${jv.jobId}.preview.mp4`));
    expect((await readFile(q.outputPath(ja.jobId))).toString()).toBe("preview-bytes");
  });

  it("preview key differs from the pdf key for the same file", async () => {
    const file = await media("klip.mp4");
    const info = await stat(file);
    const q = makeQueue(writesPreview);
    const { jobId } = await q.start(file);
    expect(jobId).not.toBe(cacheKey(file, info.size, info.mtimeMs));
    expect(jobId).toBe(cacheKey(file, info.size, info.mtimeMs, "preview"));
  });

  it("cache hit after restart returns cached true", async () => {
    const file = await media("klip.mp4");
    const q1 = makeQueue(writesPreview);
    const r1 = await q1.start(file);
    await waitState(q1, r1.jobId, "done");
    const second = vi.fn(writesPreview);
    const q2 = makeQueue(second);
    expect(await q2.start(file)).toEqual({ jobId: r1.jobId, cached: true });
    expect(second).not.toHaveBeenCalled();
  });

  it("reports an error when the converter produced no preview", async () => {
    const q = makeQueue(async () => {});
    const { jobId } = await q.start(await media("klip.mp4"));
    await waitState(q, jobId, "error");
    expect(q.status(jobId).error).toMatch(/pratinjau/);
  });
});

describe("createPreviewHandlers", () => {
  it("accepts audio and video only", async () => {
    const q = makeQueue(writesPreview);
    const h = createPreviewHandlers(async () => [root], q);
    for (const name of ["a.docx", "b.pdf", "c.xlsx", "d.txt"]) {
      await expect(h.start({ path: await media(name) })).rejects.toThrow("Hanya audio atau video");
    }
    const r = await h.start({ path: await media("lagu.mp3") });
    await waitState(q, r.jobId, "done");
    const chunk = await h.read({ jobId: r.jobId, offset: 0 });
    expect(Buffer.from(chunk.base64, "base64").toString()).toBe("preview-bytes");
    expect(h.status({ jobId: r.jobId })).toEqual({ state: "done", size: 13 });
    expect(h.cancel({ jobId: r.jobId, onlyIfQueued: true })).toEqual({});
  });

  it("rejects paths outside roots", async () => {
    const q = makeQueue(writesPreview);
    const h = createPreviewHandlers(async () => [root], q);
    const outside = path.join(base, "x.mp4");
    await writeFile(outside, "x");
    await expect(h.start({ path: outside })).rejects.toThrow("Path tidak diizinkan");
  });

  it("re-checks before spawning: a queued file swapped for an out-of-root symlink errors", async () => {
    const release = gate();
    const seen: string[] = [];
    const q = makeQueue(async (input, outDir, signal) => {
      seen.push(input);
      if (seen.length === 1) await release.promise;
      await writesPreview(input, outDir, signal);
    });
    const h = createPreviewHandlers(async () => [root], q);
    const first = await h.start({ path: await media("a.mp4") });
    await waitState(q, first.jobId, "running");
    const victim = await media("b.mp4");
    const queued = await h.start({ path: victim });
    expect(q.status(queued.jobId).state).toBe("queued");
    const outside = path.join(base, "rahasia.mp4");
    await writeFile(outside, "rahasia");
    await unlink(victim);
    await symlink(outside, victim);
    release.release();
    await waitState(q, queued.jobId, "error");
    expect(q.status(queued.jobId).error).toBe("Path tidak diizinkan");
    expect(seen).toEqual([path.join(root, "a.mp4")]);
  });
});

describe("createFfmpegRunner (fake binary)", () => {
  async function fakeBinary(body: string): Promise<string> {
    const bin = path.join(base, "fake-ffmpeg.sh");
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

  // Writes every argument to args.txt and creates the last argument (the output, `file:` stripped).
  async function recordingBinary(argsFile: string) {
    return fakeBinary(
      `printf '%s\\n' "$@" > '${argsFile}'\n` +
        `for last; do :; done\nout="\${last#file:}"\nprintf 'x' > "$out"`,
    );
  }

  it("transcodes video to 540p H.264 mp4 with faststart", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await recordingBinary(argsFile);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await media("Klip Q3 (rev).mov");
    await createFfmpegRunner({ binary: bin })(input, outDir, new AbortController().signal);
    expect(await readdir(outDir)).toEqual(["preview.mp4"]);
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toEqual([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-t",
      String(PREVIEW_MAX_SECONDS_VIDEO),
      "-i",
      `file:${input}`,
      "-map",
      "0:V:0?",
      "-map",
      "0:a:0?",
      "-vf",
      `scale=-2:'min(${PREVIEW_MAX_HEIGHT},trunc(ih/2)*2)'`,
      "-c:v",
      "libx264",
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
      "-y",
      `file:${path.join(outDir, "preview.mp4")}`,
    ]);
  });

  it("transcodes audio to 128k mp3", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await recordingBinary(argsFile);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const input = await media("rekaman.flac");
    await createFfmpegRunner({ binary: bin })(input, outDir, new AbortController().signal);
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(args).toEqual([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-t",
      String(PREVIEW_MAX_SECONDS_AUDIO),
      "-i",
      `file:${input}`,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-y",
      `file:${path.join(outDir, "preview.mp3")}`,
    ]);
  });

  it("maps an optional non-attached-picture video stream so audio-only or cover-art videos still work", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await recordingBinary(argsFile);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    await createFfmpegRunner({ binary: bin })(
      await media("hanya-suara.m4v"),
      outDir,
      new AbortController().signal,
    );
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    const maps = args.flatMap((arg, i) => (args[i - 1] === "-map" ? [arg] : []));
    // Capital V skips attached pictures (cover art); "?" makes both maps optional.
    expect(maps).toEqual(["0:V:0?", "0:a:0?"]);
    expect(args).not.toContain("0:v:0");
  });

  it("limits preview length (input -t) and x264 threads", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await recordingBinary(argsFile);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
    await createFfmpegRunner({ binary: bin })(
      await media("v.webm"),
      outDir,
      new AbortController().signal,
    );
    const video = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(after(video, "-t")).toBe("300");
    expect(video.indexOf("-t")).toBeLessThan(video.indexOf("-i"));
    expect(after(video, "-threads")).toBe("2");
    await createFfmpegRunner({ binary: bin })(
      await media("a.ogg"),
      outDir,
      new AbortController().signal,
    );
    const audio = (await readFile(argsFile, "utf8")).trim().split("\n");
    expect(after(audio, "-t")).toBe("3000");
    expect(audio.indexOf("-t")).toBeLessThan(audio.indexOf("-i"));
    expect(audio).not.toContain("-threads");
  });

  it("refuses non-media input without spawning", async () => {
    const argsFile = path.join(base, "args.txt");
    const bin = await recordingBinary(argsFile);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    await expect(
      createFfmpegRunner({ binary: bin })(
        await media("a.docx"),
        outDir,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Hanya audio atau video");
    await expect(readFile(argsFile)).rejects.toThrow();
  });

  it("fails with stderr when exit code is non-zero", async () => {
    const bin = await fakeBinary(`echo "Invalid data found when processing input" >&2\nexit 1`);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    await expect(
      createFfmpegRunner({ binary: bin })(
        await media("rusak.mp4"),
        outDir,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/ffmpeg gagal \(kode 1\).*Invalid data/s);
  });

  it("abort kills the whole process group", async () => {
    const pidFile = path.join(base, "child.pid");
    const bin = await fakeBinary(`sleep 30 &\necho $! > '${pidFile}'\nwait`);
    const outDir = path.join(base, "out");
    await mkdir(outDir);
    const controller = new AbortController();
    const run = createFfmpegRunner({ binary: bin })(
      await media("a.mp4"),
      outDir,
      controller.signal,
    );
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

describe.skipIf(process.env.RUN_FFMPEG !== "1")("ffmpeg integration", () => {
  it(
    "transcodes a 2 s 720p test clip to a smaller ≤540p H.264 preview",
    { timeout: 120_000 },
    async () => {
      const input = path.join(root, "uji 720p.mp4");
      // Generate a large-ish input: high bitrate so the preview is clearly smaller.
      execFileSync(
        "/usr/bin/nice",
        [
          "-n",
          "10",
          "/opt/homebrew/bin/ffmpeg",
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=duration=2:size=1280x720:rate=30",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=2",
          "-c:v",
          "libx264",
          "-crf",
          "5",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          "-y",
          input,
        ],
        { stdio: "ignore", timeout: 60_000 },
      );
      const q = makeQueue(createFfmpegRunner(), 90_000);
      const startedAt = Date.now();
      const { jobId } = await q.start(input);
      await vi.waitFor(() => expect(q.status(jobId).state).not.toMatch(/queued|running/), {
        timeout: 100_000,
        interval: 100,
      });
      const wallMs = Date.now() - startedAt;
      expect(q.status(jobId)).toMatchObject({ state: "done" });
      const out = q.outputPath(jobId);
      const probe = execFileSync(
        "/opt/homebrew/bin/ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,width,height",
          "-of",
          "csv=p=0",
          out,
        ],
        { encoding: "utf8" },
      ).trim();
      const [codec, width, height] = probe.split(",");
      const inSize = (await stat(input)).size;
      const outSize = (await stat(out)).size;
      const line = `RUN_FFMPEG: input=${inSize} B output=${outSize} B codec=${codec} ${width}x${height} wall=${wallMs} ms`;
      // Vitest hides console output of passing tests; RUN_FFMPEG_REPORT names a file to keep it.
      const report = process.env.RUN_FFMPEG_REPORT;
      if (report) await writeFile(report, `${line}\n`);
      expect(codec).toBe("h264");
      expect(Number(height)).toBeLessThanOrEqual(PREVIEW_MAX_HEIGHT);
      expect(Number(width) % 2).toBe(0);
      expect(outSize).toBeLessThan(inSize);
    },
  );
});

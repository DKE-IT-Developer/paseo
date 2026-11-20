import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { execCommand } from "@getpaseo/plugin/server";
import {
  toneFromUsedPct,
  unavailable,
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";

// Kuota dibaca dari `agy -p /quota`: perintah slash, dijawab CLI tanpa memanggil model (0 token).
export const inputSchema = z.object({ store: z.literal("agy") }).strict();

const outputSchema = z.object({
  status: z.string(),
  response: z.string().optional(),
  command: z
    .object({
      data: z.object({
        groups: z.array(
          z.object({
            name: z.string(),
            buckets: z.array(
              z.object({
                id: z.string(),
                window: z.string(),
                remaining_fraction: z.number(),
                reset_time: z.string().nullish(),
              }),
            ),
          }),
        ),
      }),
    })
    .nullish(),
});

type Run = () => Promise<string>;

const runAgy: Run = async () =>
  (
    await execCommand(
      "agy",
      ["-p", "/quota", "--output-format", "json", "--print-timeout", "30s"],
      {
        timeout: 45_000,
        maxBuffer: 1 << 20,
      },
    )
  ).stdout;

const WINDOW_LABEL: Record<string, string> = { weekly: "Weekly", "5h": "5-hour" };
const WINDOW_SHORT: Record<string, string> = { weekly: "wk", "5h": "5h" };

export async function fetchUsage(_input: unknown, run: Run = runAgy): Promise<UsageReport> {
  let stdout: string;
  try {
    stdout = await run();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // agy keluar dengan kode 2 bila login memakai GEMINI_API_KEY: kunci API tidak punya kuota akun.
    if (code === 2)
      return unavailable({
        kind: "no_quota",
        detail: "Antigravity uses GEMINI_API_KEY, which has no account quota (see AI Studio)",
      });
    if (code === "ENOENT") return { status: "error", error: "agy not found on PATH" };
    return { status: "error", error: `agy /quota failed: ${(error as Error).message}` };
  }

  const out = outputSchema.parse(JSON.parse(stdout));
  if (out.status !== "SUCCESS" || !out.command)
    return { status: "error", error: `agy /quota: ${out.response?.trim() || out.status}` };

  const windows = out.command.data.groups.flatMap((group, groupIndex) =>
    group.buckets.map((bucket) => {
      const usedPct = (1 - bucket.remaining_fraction) * 100;
      return windowFromUsedPct({
        id: bucket.id,
        label: `${group.name} · ${WINDOW_LABEL[bucket.window] ?? bucket.window}`,
        shortLabel: `${group.name[0]} ${WINDOW_SHORT[bucket.window] ?? bucket.window}`,
        summary: groupIndex === 0,
        utilizationPct: usedPct,
        resetsAt: bucket.reset_time ?? null,
        tone: toneFromUsedPct(usedPct),
      });
    }),
  );
  return { status: "available", windows };
}

function onPath(env: NodeJS.ProcessEnv | Record<string, string>): boolean {
  return (env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, "agy"), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export async function discover(
  scope: UsageScope,
  env: NodeJS.ProcessEnv | Record<string, string> = process.env,
  hasAgy: () => boolean = () => onPath(env),
): Promise<UsageAccount[]> {
  if (scope.kind === "session" && scope.provider !== "antigravity") return [];
  const effective = scope.kind === "session" ? { ...env, ...scope.env } : env;
  if (effective.GEMINI_API_KEY || !hasAgy()) return [];
  // ponytail: satu login agy per host; key "default" karena CLI tidak memberi id akun.
  return [{ key: "default", harness: "Antigravity", input: { store: "agy" } }];
}

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const chunkOutput = z.object({ base64: z.string(), nextOffset: z.number(), eof: z.boolean() });

export const fileStat = defineRpc({
  name: "dke-media.file.stat",
  input: z.object({ path: z.string() }),
  output: z.object({ size: z.number(), mtimeMs: z.number(), mimeType: z.string() }),
});

export const fileRead = defineRpc({
  name: "dke-media.file.read",
  input: z.object({ path: z.string(), offset: z.number().int().nonnegative() }),
  output: chunkOutput,
});

export const convertStart = defineRpc({
  name: "dke-media.convert.start",
  input: z.object({ path: z.string() }),
  output: z.object({ jobId: z.string(), cached: z.boolean() }),
});

export const convertStatus = defineRpc({
  name: "dke-media.convert.status",
  input: z.object({ jobId: z.string() }),
  output: z.object({
    state: z.enum(["queued", "running", "done", "error", "cancelled"]),
    error: z.string().optional(),
    size: z.number().optional(),
  }),
});

export const convertCancel = defineRpc({
  name: "dke-media.convert.cancel",
  // onlyIfQueued is optional so older clients that send only jobId keep working.
  input: z.object({ jobId: z.string(), onlyIfQueued: z.boolean().optional() }),
  output: z.object({}),
});

export const convertRead = defineRpc({
  name: "dke-media.convert.read",
  input: z.object({ jobId: z.string(), offset: z.number().int().nonnegative() }),
  output: chunkOutput,
});

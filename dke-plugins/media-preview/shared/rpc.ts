import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const fileStat = defineRpc({
  name: "dke-media.file.stat",
  input: z.object({ path: z.string() }),
  output: z.object({ size: z.number(), mtimeMs: z.number(), mimeType: z.string() }),
});

export const fileRead = defineRpc({
  name: "dke-media.file.read",
  input: z.object({ path: z.string(), offset: z.number().int().nonnegative() }),
  output: z.object({ base64: z.string(), nextOffset: z.number(), eof: z.boolean() }),
});

import { z } from "zod";

export const MEDIA_MESSAGE_KIND = "dke-media-message";
export const MEDIA_MESSAGE_VERSION = 1;

export const mediaMessageSchema = z.object({
  text: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(["audio", "video", "pdf", "office", "sheet"]),
    }),
  ),
});

export type MediaMessageData = z.output<typeof mediaMessageSchema>;

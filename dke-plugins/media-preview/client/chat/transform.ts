import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { MEDIA_MESSAGE_KIND, MEDIA_MESSAGE_VERSION } from "../../shared/media-message";
import { findMediaPaths } from "./find-paths";

type Contribution = PluginTimelineTransformerContribution<"assistant_message">;

/** Pure and synchronous: runs on every streaming update. Only claims finished messages with media. */
export const mediaMessageTransformer = {
  id: "media-message",
  query: { itemType: "assistant_message" },
  transform({ item, phase }) {
    if (phase === "streaming") return undefined;
    const files = findMediaPaths(item.text);
    if (files.length === 0) return undefined;
    return {
      items: [
        {
          type: "plugin",
          kind: MEDIA_MESSAGE_KIND,
          version: MEDIA_MESSAGE_VERSION,
          // plain object literals: interfaces are not assignable to the JSON-compatible data type
          data: { text: item.text, files: files.map(({ path, kind }) => ({ path, kind })) },
        },
      ],
    };
  },
} satisfies Contribution;

import { describe, expect, it } from "vitest";
import { mediaMessageTransformer } from "./transform";

const run = (text: string, phase: "streaming" | "complete") =>
  mediaMessageTransformer.transform({ item: { type: "assistant_message", text }, phase });

describe("media message transformer", () => {
  it("targets assistant messages", () => {
    expect(mediaMessageTransformer.id).toBe("media-message");
    expect(mediaMessageTransformer.query).toEqual({ itemType: "assistant_message" });
  });

  it("streaming returns undefined", () => {
    expect(run("ada /tmp/a.mp3", "streaming")).toBeUndefined();
  });

  it("no media returns undefined", () => {
    expect(run("tidak ada berkas, hanya /tmp/data.csv", "complete")).toBeUndefined();
  });

  it("complete with media returns one dke-media-message item carrying original text", () => {
    const text = "Rekaman: /tmp/a.mp3";
    expect(run(text, "complete")).toEqual({
      items: [
        {
          type: "plugin",
          kind: "dke-media-message",
          version: 1,
          data: { text, files: [{ path: "/tmp/a.mp3", kind: "audio" }] },
        },
      ],
    });
  });
});

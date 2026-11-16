import { describe, expect, it } from "vitest";
import { EXTENSIONS, MEDIA_KINDS } from "./kinds";
import { mediaMessageSchema } from "./media-message";

describe("mediaMessageSchema kind", () => {
  it("accepts exactly the kinds defined in shared/kinds", () => {
    const kindSchema = mediaMessageSchema.shape.files.element.shape.kind;
    expect([...kindSchema.options].sort()).toEqual([...MEDIA_KINDS].sort());
    expect(Object.keys(EXTENSIONS).sort()).toEqual([...MEDIA_KINDS].sort());
  });
});

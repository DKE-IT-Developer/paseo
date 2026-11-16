import { describe, expect, it } from "vitest";
import { shouldAutoLoad } from "./autoload";
import { PANEL_AUTOLOAD_MAX_BYTES } from "../shared/limits";

describe("shouldAutoLoad", () => {
  it("memuat otomatis tepat di batas", () => {
    expect(shouldAutoLoad(PANEL_AUTOLOAD_MAX_BYTES, PANEL_AUTOLOAD_MAX_BYTES)).toBe(true);
  });
  it("tidak memuat otomatis di atas batas", () => {
    expect(shouldAutoLoad(PANEL_AUTOLOAD_MAX_BYTES + 1, PANEL_AUTOLOAD_MAX_BYTES)).toBe(false);
  });
});

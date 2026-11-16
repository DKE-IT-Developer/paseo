import { describe, expect, it } from "vitest";
import { type OfficeState, officeReducer } from "./office-state";

const idle: OfficeState = { phase: "idle" };

describe("officeReducer", () => {
  it("started moves idle to converting", () => {
    expect(officeReducer(idle, { type: "started", jobId: "j1" })).toEqual({
      phase: "converting",
      jobId: "j1",
    });
  });

  it("queued/running keep converting (same state object)", () => {
    const s: OfficeState = { phase: "converting", jobId: "j1" };
    expect(officeReducer(s, { type: "status", state: "running" })).toBe(s);
    expect(officeReducer(s, { type: "status", state: "queued" })).toBe(s);
  });

  it("done moves converting to loading", () => {
    const s: OfficeState = { phase: "converting", jobId: "j1" };
    expect(officeReducer(s, { type: "status", state: "done" })).toEqual({
      phase: "loading",
      jobId: "j1",
    });
  });

  it("error carries the message", () => {
    const s: OfficeState = { phase: "converting", jobId: "j1" };
    expect(officeReducer(s, { type: "status", state: "error", error: "rusak" })).toEqual({
      phase: "error",
      jobId: "j1",
      error: "rusak",
    });
  });

  it("error without message gets a default", () => {
    const s: OfficeState = { phase: "converting", jobId: "j1" };
    const next = officeReducer(s, { type: "status", state: "error" });
    expect(next.phase).toBe("error");
    expect(next.error).toBeTruthy();
  });

  it("cancel from converting becomes cancelled", () => {
    const s: OfficeState = { phase: "converting", jobId: "j1" };
    expect(officeReducer(s, { type: "cancel" }).phase).toBe("cancelled");
  });

  it("status events are ignored outside converting", () => {
    const s: OfficeState = { phase: "cancelled", jobId: "j1" };
    expect(officeReducer(s, { type: "status", state: "done" })).toBe(s);
  });

  it("loaded moves loading to ready; failed moves to error; retry resets", () => {
    const l: OfficeState = { phase: "loading", jobId: "j1" };
    expect(officeReducer(l, { type: "loaded" }).phase).toBe("ready");
    expect(officeReducer(l, { type: "failed", message: "x" })).toEqual({
      phase: "error",
      jobId: "j1",
      error: "x",
    });
    expect(officeReducer({ phase: "error", error: "x" }, { type: "retry" })).toEqual(idle);
  });
});

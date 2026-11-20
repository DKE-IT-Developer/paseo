import { describe, expect, it } from "vitest";
import quota from "../test/quota.json";
import { discover, fetchUsage } from "./usage.js";

const real = JSON.stringify(quota);
const fail = (props: object) => () => Promise.reject(Object.assign(new Error("agy failed"), props));

describe("fetchUsage", () => {
  it("maps every quota bucket to a window, Gemini in the summary", async () => {
    const report = await fetchUsage({ store: "agy" }, () => Promise.resolve(real));
    if (report.status !== "available") throw new Error(report.status);
    expect(report.windows.map((w) => [w.id, w.shortLabel, w.summary ?? false])).toEqual([
      ["gemini-weekly", "G wk", true],
      ["gemini-5h", "G 5h", true],
      ["3p-weekly", "C wk", false],
      ["3p-5h", "C 5h", false],
    ]);
    const weekly = report.windows[0];
    expect(weekly.label).toBe("Gemini Models · Weekly");
    expect(weekly.usedPct).toBeCloseTo(6.31, 1);
    expect(weekly.remainingPct).toBeCloseTo(93.69, 1);
    expect(weekly.resetsAt).toBe("2026-11-25T23:33:59Z");
    expect(weekly.tone).toBe("ok");
  });

  it("warns as a bucket runs low", async () => {
    const low = structuredClone(quota);
    low.command.data.groups[0].buckets[1].remaining_fraction = 0.05;
    const report = await fetchUsage({ store: "agy" }, () => Promise.resolve(JSON.stringify(low)));
    if (report.status !== "available") throw new Error(report.status);
    expect(report.windows[1].tone).toBe("danger");
  });

  it("reports no quota when agy runs on an API key (exit 2)", async () => {
    const report = await fetchUsage({ store: "agy" }, fail({ code: 2 }));
    expect(report).toEqual({
      status: "unavailable",
      problem: { kind: "no_quota", detail: expect.stringContaining("GEMINI_API_KEY") },
    });
  });

  it("reports a missing CLI and a failed command as errors", async () => {
    expect(await fetchUsage({ store: "agy" }, fail({ code: "ENOENT" }))).toEqual({
      status: "error",
      error: expect.stringContaining("not found"),
    });
    const bad = JSON.stringify({ status: "ERROR", response: "not signed in" });
    expect(await fetchUsage({ store: "agy" }, () => Promise.resolve(bad))).toEqual({
      status: "error",
      error: expect.stringContaining("not signed in"),
    });
  });
});

describe("discover", () => {
  const agy = { store: "agy" };
  it("offers the signed-in account globally and in Antigravity sessions only", async () => {
    expect(await discover({ kind: "global" }, {}, () => true)).toEqual([
      { key: "default", harness: "Antigravity", input: agy },
    ]);
    expect(
      await discover({ kind: "session", provider: "antigravity", env: {} }, {}, () => true),
    ).toHaveLength(1);
    expect(
      await discover({ kind: "session", provider: "claude", env: {} }, {}, () => true),
    ).toEqual([]);
  });

  it("skips API-key logins and hosts without agy", async () => {
    expect(await discover({ kind: "global" }, { GEMINI_API_KEY: "x" }, () => true)).toEqual([]);
    expect(
      await discover(
        { kind: "session", provider: "antigravity", env: { GEMINI_API_KEY: "x" } },
        {},
        () => true,
      ),
    ).toEqual([]);
    expect(await discover({ kind: "global" }, {}, () => false)).toEqual([]);
  });
});

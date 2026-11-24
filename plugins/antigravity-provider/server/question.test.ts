import { describe, expect, it } from "vitest";
import type { AcpToolCallSnapshot } from "@getpaseo/plugin/server/acp";
import { mapQuestion } from "./tool-calls.js";

// Shape agy 1.5.16 sends over ACP for ask_question (captured from `agy acp`).
const call = (overrides: Partial<AcpToolCallSnapshot> = {}) =>
  ({
    id: "call_1",
    name: "ask_question",
    title: "Run ask_question",
    kind: "other",
    status: "pending",
    input: {
      questions: [
        { is_multi_select: false, options: ["Merah", "Biru"], question: "Warna mana?" },
        { is_multi_select: true, options: ["A", "B", "C"], question: "Fitur?" },
      ],
    },
    locations: [],
    ...overrides,
  }) as unknown as AcpToolCallSnapshot;

describe("mapQuestion (agy ask_question)", () => {
  it("maps every question with its options and multi-select flag", () => {
    expect(mapQuestion(call(), { sessionId: "s" })).toEqual([
      { question: "Warna mana?", options: ["Merah", "Biru"], multiSelect: false },
      { question: "Fitur?", options: ["A", "B", "C"], multiSelect: true },
    ]);
  });

  it("ignores other tools and malformed input", () => {
    expect(mapQuestion(call({ name: "run_command" }), { sessionId: "s" })).toBeNull();
    expect(mapQuestion(call({ input: { questions: [] } as never }), { sessionId: "s" })).toBeNull();
    expect(mapQuestion(call({ input: "x" as never }), { sessionId: "s" })).toBeNull();
  });
});

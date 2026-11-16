import { describe, expect, it } from "vitest";
import { agentWebUrl } from "./web-link";

describe("agentWebUrl", () => {
  it("builds the web route of the agent conversation on the DKE web UI", () => {
    expect(agentWebUrl("srv_WHIU50mGpm30", "17072ea8-b6ee-41da-b2e2-b213405849eb")).toBe(
      "https://paseo.dke.dev/h/srv_WHIU50mGpm30/agent/17072ea8-b6ee-41da-b2e2-b213405849eb",
    );
  });

  it("encodes ids so they stay one path segment", () => {
    expect(agentWebUrl("srv/x", "a b")).toBe("https://paseo.dke.dev/h/srv%2Fx/agent/a%20b");
  });
});

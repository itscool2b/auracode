import { describe, expect, it } from "vitest";
import { holdFirstMessage, takeFirstMessage } from "./firstMessage";

describe("New chat's first message", () => {
  it("reaches its own chat once, and blank words hold nothing", () => {
    holdFirstMessage("chat-a", "Fix the header spacing");
    holdFirstMessage("chat-b", "   ");
    expect(takeFirstMessage("chat-b")).toBeNull();
    expect(takeFirstMessage("chat-a")).toBe("Fix the header spacing");
    // Taken once: a view that mounts twice (React's strict mode) sends nothing the second time.
    expect(takeFirstMessage("chat-a")).toBeNull();
  });
});

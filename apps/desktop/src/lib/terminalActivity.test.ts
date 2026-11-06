import { describe, expect, it } from "vitest";
import { ECHO_MS, QUIET_MS, TerminalActivity } from "./terminalActivity";

describe("a terminal agent at work", () => {
  it("works while it draws, and waits once it has been quiet", () => {
    const activity = new TerminalActivity();
    expect(activity.working(1_000)).toBe(false);
    // A spinner ticking every second.
    for (let at = 1_000; at <= 5_000; at += 1_000) activity.output(at);
    expect(activity.working(5_500)).toBe(true);
    expect(activity.working(5_000 + QUIET_MS - 1)).toBe(true);
    expect(activity.working(5_000 + QUIET_MS)).toBe(false);
  });

  it("does not count the echo of typing or a redraw after a resize as work", () => {
    const activity = new TerminalActivity();
    for (let at = 10_000; at <= 14_000; at += 150) {
      activity.poke(at);
      activity.output(at + 20);
    }
    expect(activity.working(14_100)).toBe(false);
    // The answer comes later than an echo would: that is the agent working.
    activity.output(14_000 + ECHO_MS + 1);
    expect(activity.working(14_000 + ECHO_MS + 2)).toBe(true);
  });

  it("keeps working while the person types between the agent's own redraws", () => {
    const activity = new TerminalActivity();
    activity.output(20_000);
    activity.poke(20_500);
    activity.output(20_520);
    activity.output(21_400);
    expect(activity.working(21_500)).toBe(true);
  });
});

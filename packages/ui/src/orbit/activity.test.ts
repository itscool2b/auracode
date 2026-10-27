import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrbState } from "../orb/states";
import { motionDeadline, type OrbitActivity, transitionActivity } from "./activity";
import { type ActivitySegment, SIGNATURES, travelPhase } from "./geometry";
import { OrbitMark } from "./OrbitMark";

describe("Orbit live activity", () => {
  it("compacts long chats while retaining the travelled phase", () => {
    let activity: OrbitActivity | null = null;
    const reference: ActivitySegment[] = [];
    const states: OrbState[] = ["thinking", "streaming", "tool", "waiting", "idle"];
    for (let index = 0; index < 300; index++) {
      const state = states[index % states.length] ?? "idle";
      activity = transitionActivity(activity, state, index * 100);
      const previous = reference.pop();
      if (previous) reference.push({ ...previous, to: index * 100 });
      reference.push({ from: index * 100, to: null, state });
      expect(activity.timeline.segments.length).toBeLessThanOrEqual(64);
      expect(activity.timeline.ripples.length).toBeLessThanOrEqual(8);
      expect(travelPhase(activity.timeline, SIGNATURES.codex, index * 100 + 50)).toBeCloseTo(
        travelPhase(
          { segments: reference, ripples: [], streamedChars: 0 },
          SIGNATURES.codex,
          index * 100 + 50,
        ),
        8,
      );
    }
  });

  it("does not restart motion when the same state renders again", () => {
    const activity = transitionActivity(null, "done", 100);
    expect(transitionActivity(activity, "done", 500)).toBe(activity);
    expect(motionDeadline(activity)).toBe(2250);
    expect(motionDeadline(transitionActivity(null, "idle", 100))).toBe(100);
    expect(motionDeadline(transitionActivity(null, "thinking", 100))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("server renders accessible state geometry without a browser or GPU", () => {
    const html = renderToString(createElement(OrbitMark, { agent: "claude", state: "waiting" }));
    expect(html).toContain('aria-label="Claude Code, waiting for approval"');
    expect(html).toContain('data-agent="claude-code"');
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain('data-tone="signal"');
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("gradient");
  });

  it("finishes the tool completion ripple and then stops even when returning to idle", () => {
    const tool = transitionActivity(null, "tool", 100);
    const idle = transitionActivity(tool, "idle", 200);
    expect(motionDeadline(idle)).toBe(820);
    expect(transitionActivity(idle, "idle", 900)).toBe(idle);
  });

  it("keeps an unknown agent visible as a dashed orbit and clamps invalid sizes", () => {
    const html = renderToString(
      createElement(OrbitMark, { agent: "future-agent", size: Number.NaN }),
    );
    expect(html).toContain('data-agent="generic"');
    expect(html).toContain('data-hollow=""');
    expect(html).toContain('width="24"');
  });
});

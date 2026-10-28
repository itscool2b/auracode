import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_BRAND_IDS } from "../brand";
import { ORB_STATES, type OrbState } from "../orb/states";
import { AgentMark, agentCode } from "./AgentMark";
import { loaderCellClass } from "./PixelLoader";
import { loaderFrame } from "./pixels";

const mark = (props: Parameters<typeof AgentMark>[0]) =>
  renderToStaticMarkup(createElement(AgentMark, props));

describe("AgentMark", () => {
  it("server renders an accessible state without a browser, canvas or gradient", () => {
    const html = renderToString(createElement(AgentMark, { agent: "claude", state: "waiting" }));
    expect(html).toContain('aria-label="Claude Code, waiting for approval"');
    expect(html).toContain('role="img"');
    expect(html).toContain('data-agent="claude-code"');
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain('class="g-agent-mark"');
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("gradient");
  });

  it("keeps the OrbitMark props, so call sites swap by name", () => {
    const html = mark({
      agent: "codex",
      state: "tool",
      size: 16,
      label: "Running cargo test",
      ghost: false,
      className: "chat-gutter-mark",
    });
    expect(html).toContain('aria-label="Running cargo test"');
    expect(html).toContain('class="g-agent-mark chat-gutter-mark"');
    expect(html).toContain('data-agent="codex"');
    expect(html).toContain("width:16px");
  });

  it("shows the agent's full code at rest at every size, so no two agents share a mark", () => {
    expect(mark({ agent: "claude", size: 14 })).toContain(">CC</span>");
    expect(mark({ agent: "codex", size: 14 })).toContain(">CX</span>");
    expect(mark({ agent: "claude", size: 16 })).toContain(">CC</span>");
    expect(mark({ agent: "codex", size: 16 })).toContain(">CX</span>");
    expect(mark({ agent: "opencode", size: 16 })).toContain(">OC</span>");
    expect(mark({ agent: "pi", size: 16 })).toContain(">PI</span>");
    expect(mark({ agent: "claude", size: 24 })).toContain(">CC</span>");
    expect(mark({ agent: "codex", size: 48 })).toContain(">CX</span>");
    expect(mark({ agent: "grok", size: 56 })).toContain(">GB</span>");
    const small = [14, 16, 20].flatMap((size) =>
      AGENT_BRAND_IDS.filter((id) => id !== "generic").map((id) => mark({ agent: id, size })),
    );
    for (const html of small) expect(html).toMatch(/>[A-Z]{2}<\/span>/);
  });

  it("sizes a two-letter code to fit its tile, never under 7px", () => {
    expect(mark({ agent: "claude", size: 12 })).toContain("font-size:7px");
    expect(mark({ agent: "claude", size: 16 })).toContain("font-size:8px");
    expect(mark({ agent: "claude", size: 24 })).toContain("font-size:9px");
    expect(mark({ agent: "claude", size: 48 })).toContain("font-size:18px");
    expect(mark({ agent: "", size: 16 })).toContain("font-size:9px");
  });

  it("puts each state in the glyph's place", () => {
    const shapes: Record<OrbState, string> = {
      idle: "g-agent-mark-glyph",
      thinking: "g-px",
      streaming: "g-px",
      tool: "g-px",
      waiting: "g-agent-mark-waiting",
      done: "g-agent-mark-check",
      error: "g-agent-mark-error",
    };
    for (const state of ORB_STATES) {
      const html = mark({ agent: "pi", state, size: 24 });
      expect(html, state).toContain(shapes[state]);
      expect(html, state).toContain(`data-state="${state}"`);
      if (state !== "idle") expect(html, state).not.toContain("g-agent-mark-glyph");
    }
  });

  it("renders the loader's static pattern first, which is all reduced motion ever shows", () => {
    const html = mark({ agent: "claude", state: "thinking", size: 24 });
    const classes = [...html.matchAll(/<rect class="([^"]+)"/g)].map((m) => m[1]);
    expect(classes).toEqual(loaderFrame(0).map((level) => loaderCellClass(level)));
    expect(classes.filter((c) => c?.includes("g-px-3"))).toHaveLength(1);
  });

  it("draws the done check once, a pixel at a time, through CSS rather than a frame loop", () => {
    const html = mark({ agent: "claude", state: "done", size: 32 });
    const delays = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([0, 50, 100, 150, 200]);
  });

  it("keeps unknown agents visible with their own letters and clamps invalid sizes", () => {
    const html = mark({ agent: "future-agent", size: Number.NaN });
    expect(html).toContain('data-agent="generic"');
    expect(html).toContain("width:24px");
    expect(html).toContain(">FU</span>");
    expect(mark({ agent: "agent", size: 400 })).toContain("width:256px");
    expect(mark({ agent: "agent", size: 2 })).toContain("width:12px");
  });

  it("treats an unknown state as idle", () => {
    const html = mark({ agent: "claude", state: "sleeping" as OrbState });
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('aria-label="Claude Code, idle"');
  });

  it("draws a ghost as an empty dashed tile with its code, whatever the state", () => {
    const html = mark({ agent: "cursor", state: "thinking", ghost: true, size: 24 });
    expect(html).toContain('data-ghost=""');
    expect(html).toContain(">CU</span>");
    expect(html).not.toContain("g-px");
  });
});

describe("agent codes", () => {
  it("gives every designed agent a distinct two-letter code", () => {
    const codes = AGENT_BRAND_IDS.filter((id) => id !== "generic").map(agentCode);
    expect(codes).toEqual(["CC", "CX", "PI", "AG", "CU", "GB", "OC", "MP", "HM"]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("resolves aliases and spells out unknown ids", () => {
    expect(agentCode("Claude Code")).toBe("CC");
    expect(agentCode("cursor-agent")).toBe("CU");
    expect(agentCode("gemini-cli")).toBe("GE");
    expect(agentCode("generic")).toBe("?");
    expect(agentCode("")).toBe("?");
    expect(agentCode("!!")).toBe("?");
  });
});

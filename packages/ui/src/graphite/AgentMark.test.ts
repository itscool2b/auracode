import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_BRAND_IDS } from "../brand";
import { ORB_STATES, type OrbState } from "../orb/states";
import { AgentMark, agentCode, logoSide } from "./AgentMark";
import { AGENT_LOGOS } from "./agentLogos";
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

  it("shows every designed agent's published logo at rest, and a code for any other agent", () => {
    for (const size of [14, 16, 20, 24, 32, 48, 56]) {
      for (const id of AGENT_BRAND_IDS.filter((brand) => brand !== "generic")) {
        const html = mark({ agent: id, size });
        expect(AGENT_LOGOS[id as keyof typeof AGENT_LOGOS], id).toBeDefined();
        expect(html, `${id} ${size}`).toContain(`data-agent-logo="${id}"`);
        expect(html, `${id} ${size}`).toContain('data-logo=""');
        expect(html, `${id} ${size}`).not.toContain("g-agent-mark-glyph");
        expect(html, `${id} ${size}`).not.toContain("font-size");
      }
      const custom = mark({ agent: "my-acp-agent", size });
      expect(custom, `custom ${size}`).toContain(">MY</span>");
      expect(custom, `custom ${size}`).not.toContain("data-logo");
    }
    expect(mark({ agent: "codex", size: 16 })).toContain('data-agent-logo="codex"');
    expect(mark({ agent: "claude", size: 16 })).toContain('data-agent-logo="claude-code"');
    expect(mark({ agent: "grok", size: 56 })).toContain('data-agent-logo="grok"');
  });

  it("draws a logo inside an even margin of its tile, centred on whole pixels", () => {
    expect([12, 14, 16, 20, 24, 32, 48, 56].map(logoSide)).toEqual([8, 10, 12, 14, 16, 22, 32, 36]);
    for (const size of [13, 14, 15, 16, 17, 20, 24, 31, 32, 56]) {
      expect((size - logoSide(size)) % 2, `${size}`).toBe(0);
      expect(size - logoSide(size), `${size}`).toBeGreaterThanOrEqual(4);
    }
    const html = mark({ agent: "cursor", size: 24 });
    expect(html).toContain('width="16" height="16"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).not.toContain("<title>");
  });

  it("sizes a two-letter code to fit its tile, never under 7px", () => {
    expect(mark({ agent: "my-acp-agent", size: 12 })).toContain("font-size:7px");
    expect(mark({ agent: "my-acp-agent", size: 16 })).toContain("font-size:8px");
    expect(mark({ agent: "my-acp-agent", size: 24 })).toContain("font-size:9px");
    expect(mark({ agent: "my-acp-agent", size: 48 })).toContain("font-size:18px");
    expect(mark({ agent: "", size: 16 })).toContain("font-size:9px");
  });

  it("puts each state in the glyph's place", () => {
    const shapes: Record<OrbState, string> = {
      idle: "g-agent-mark-logo",
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
      if (state !== "idle") {
        expect(html, state).not.toContain("g-agent-mark-logo");
        expect(html, state).not.toContain("g-agent-mark-glyph");
        expect(mark({ agent: "claude", state, size: 24 }), state).not.toContain(">CC<");
      }
    }
  });

  it("shows waiting and failed as dots centred on whole pixels", () => {
    for (const [state, size, centre, radius] of [
      ["waiting", 24, 12, 5],
      ["error", 16, 8, 3],
      ["waiting", 14, 7, 3],
    ] as const) {
      const html = mark({ agent: "pi", state, size });
      expect(html, `${state} ${size}`).toContain(`<circle class="g-agent-mark-${state}"`);
      expect(html).toContain(`cx="${centre}" cy="${centre}" r="${radius}"`);
      expect(html).not.toContain("<rect");
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

  it("draws a ghost as an empty dashed tile with its logo or code, whatever the state", () => {
    const html = mark({ agent: "cursor", state: "thinking", ghost: true, size: 24 });
    expect(html).toContain('data-ghost=""');
    expect(html).toContain('data-agent-logo="cursor"');
    expect(html).not.toContain("g-px");
    const code = mark({ agent: "my-acp-agent", state: "waiting", ghost: true, size: 24 });
    expect(code).toContain(">MY</span>");
    expect(code).not.toContain("g-agent-mark-waiting");
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

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_BRANDS } from "../brand";
import { AuraField } from "./AuraField";
import { GlassPanel } from "./GlassPanel";
import { Orb } from "./Orb";

/*
 * The website server-renders these components, so rendering must never touch window, document,
 * or WebGL, and the markup must already be meaningful before hydration.
 */
describe("server rendering", () => {
  it("renders an Orb as an accessible poster, with no canvas until hydration", () => {
    const html = renderToString(
      createElement(Orb, {
        brand: "codex",
        state: "thinking",
        size: 120,
        label: "Codex is thinking",
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Codex is thinking"');
    expect(html).toContain('data-orb-state="thinking"');
    expect(html).toContain("radial-gradient(");
    expect(html).toContain("width:120px");
    expect(html).not.toContain("<canvas");
  });

  it("labels an Orb from its brand and state by default", () => {
    const html = renderToString(createElement(Orb, { brand: "claude", state: "waiting" }));
    expect(html).toContain('aria-label="Claude Code, waiting for approval"');
    expect(html).toContain('data-orb-brand="claude-code"');
  });

  it("falls back to the generic brand for unknown agents", () => {
    const html = renderToString(createElement(Orb, { brand: "brand-new-agent" }));
    expect(html).toContain('data-orb-brand="generic"');
  });

  it("renders a GlassPanel without backdrop-filter by default", () => {
    const html = renderToString(createElement(GlassPanel, null, "content"));
    expect(html).toContain("content");
    expect(html).toContain('data-elevation="1"');
    expect(html).toContain("var(--aura-elev-1-fill)");
    expect(html).not.toContain("backdrop-filter");
  });

  it("adds the prefixed and standard backdrop-filter only when blur is on", () => {
    const html = renderToString(createElement(GlassPanel, { blur: true, elevation: 3 }, "menu"));
    expect(html).toContain("-webkit-backdrop-filter:blur(var(--aura-blur-overlay))");
    expect(html).toMatch(/[;"]backdrop-filter:blur\(var\(--aura-blur-overlay\)\)/);
    expect(html).toContain("var(--aura-overlay-scrim)");
  });

  it("draws the squircle hairline as an SVG stroke inside the clipped layer", () => {
    const html = renderToString(createElement(GlassPanel, { squircle: true, elevation: 2 }, "x"));
    expect(html).toContain("<svg");
    expect(html).toContain("<linearGradient");
    expect(html).toContain("var(--aura-elev-2-hairline-top)");
    expect(html).toContain('stroke-width="2"');
  });

  it("clamps an out-of-range elevation", () => {
    const html = renderToString(createElement(GlassPanel, { elevation: 7 as 1 }, "x"));
    expect(html).toContain('data-elevation="1"');
  });

  it("renders the AuraField as decorative light in brand colours", () => {
    const html = renderToString(
      createElement(AuraField, { brand: "antigravity", intensity: "active" }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-intensity="active"');
    expect(html).toContain(AGENT_BRANDS.antigravity.glow);
    expect(html).toContain("filter:blur(var(--aura-blur-field))");
  });

  it("shows the amber layer only on alert", () => {
    const calm = renderToString(createElement(AuraField, { brand: "codex", intensity: "calm" }));
    const alert = renderToString(createElement(AuraField, { brand: "codex", intensity: "alert" }));
    const amberLayerOpacity = (html: string) =>
      /opacity:([\d.]+);transition:[^"]*"><div[^>]*var\(--aura-warning\)/.exec(html)?.[1];
    expect(amberLayerOpacity(calm)).toBe("0");
    expect(amberLayerOpacity(alert)).toBe("0.85");
  });
});

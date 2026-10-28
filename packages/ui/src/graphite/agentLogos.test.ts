import { describe, expect, it } from "vitest";
import { AGENT_BRANDS } from "../brand";
import { AGENT_LOGO_SOURCES, AGENT_LOGOS, agentLogo, parseLogo } from "./agentLogos";

const sources = Object.entries(AGENT_LOGO_SOURCES);

describe("agent logos", () => {
  it("draws a logo for each agent with a stored mark and for nothing else", () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(Object.keys(AGENT_LOGOS).sort()).toEqual(Object.keys(AGENT_LOGO_SOURCES).sort());
    expect(Object.keys(AGENT_LOGOS)).not.toContain("generic");
  });

  it("keeps every file to plain vector shapes: no raster, script, link, style or reference", () => {
    for (const [id, svg] of sources) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="'), id).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>"), id).toBe(true);
      for (const banned of [
        /<script/i,
        /<image/i,
        /<foreignObject/i,
        /<style/i,
        /<use[\s>]/i,
        /<a[\s>]/i,
        /<filter/i,
        /\shref=/i,
        /xlink:/i,
        /\son[a-z]+=/i,
        /url\(/i,
        /data:/i,
        /https?:\/\/(?!www\.w3\.org\/2000\/svg")/i,
        /<!DOCTYPE/i,
        /<!ENTITY/i,
        /<\?xml/i,
        /<!--/,
        /\sid=/i,
        /\sclass=/i,
        /\sstyle=/i,
      ]) {
        expect(svg, `${id} ${banned}`).not.toMatch(banned);
      }
      expect(svg.length, id).toBeLessThan(12_000);
    }
  });

  it("names each stored mark after its agent", () => {
    for (const [id, svg] of sources) {
      const label = AGENT_BRANDS[id as keyof typeof AGENT_BRANDS].name;
      expect(svg, id).toContain('role="img"');
      expect(svg, id).toContain(`aria-label="${label}"`);
      expect(svg, id).toContain(`<title>${label}</title>`);
    }
  });

  it("reads each file as its viewBox and flat shapes, with only fills and geometry", () => {
    const allowed = new Set([
      "d",
      "fill",
      "fill-rule",
      "clip-rule",
      "fill-opacity",
      "opacity",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "x",
      "y",
      "width",
      "height",
      "points",
    ]);
    for (const [id, logo] of Object.entries(AGENT_LOGOS)) {
      expect(logo.shapes.length, id).toBeGreaterThan(0);
      for (const shape of logo.shapes)
        for (const name of Object.keys(shape.attributes))
          expect(allowed, `${id} ${name}`).toContain(name);
      expect(logo.scale, id).toBeGreaterThan(0.5);
      expect(logo.scale, id).toBeLessThanOrEqual(1);
    }
  });

  it("refuses anything but flat shapes inside the root", () => {
    const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
    expect(() => parseLogo(`${head}<g><path d="M0 0h1"/></g></svg>`)).toThrow();
    expect(() => parseLogo(`${head}<text>x</text></svg>`)).toThrow();
    expect(() => parseLogo(`${head}</svg>`)).toThrow();
    expect(() => parseLogo('<svg viewBox="a b c d"><path d="M0 0h1"/></svg>')).toThrow();
    expect(parseLogo(`${head}<title>X</title><path fill="#fff" d="M0 0h1"/></svg>`)).toEqual({
      viewBox: "0 0 10 10",
      shapes: [{ tag: "path", attributes: { fill: "#fff", d: "M0 0h1" } }],
    });
  });

  it("resolves aliases and gives unknown agents no logo", () => {
    expect(agentLogo("claude")).toBe(agentLogo("claude-code"));
    expect(agentLogo("Claude Code")).toBe(agentLogo("claude-code"));
    expect(agentLogo("future-agent")).toBeNull();
    expect(agentLogo("generic")).toBeNull();
    expect(agentLogo("")).toBeNull();
  });
});

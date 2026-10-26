import { describe, expect, it } from "vitest";
import { AGENT_BRANDS, getBrand } from "../brand";
import { parseHexColor } from "../color";
import { orbPosterBackground } from "./poster";

function colors(background: string): string[] {
  return background.match(/#[0-9a-f]{6}/g) ?? [];
}

describe("orbPosterBackground", () => {
  it("paints radial gradients in the brand's own colours", () => {
    const poster = orbPosterBackground(AGENT_BRANDS.codex);
    expect(poster.match(/radial-gradient\(/g)).toHaveLength(3);
    for (const stop of AGENT_BRANDS.codex.palette) expect(poster).toContain(stop);
    expect(poster).toContain("transparent");
  });

  it("uses the generic aurora for unknown agents", () => {
    expect(orbPosterBackground(getBrand("some-new-agent"))).toBe(
      orbPosterBackground(AGENT_BRANDS.generic),
    );
  });

  it("tints waiting toward amber and error toward red, like the shader", () => {
    const brand = AGENT_BRANDS.antigravity;
    const idle = orbPosterBackground(brand, "idle");
    const waiting = orbPosterBackground(brand, "waiting");
    const error = orbPosterBackground(brand, "error");
    expect(waiting).not.toBe(idle);
    expect(error).not.toBe(idle);

    // The second colour listed is the bright lobe (palette stop 2).
    const lobe = (background: string) => parseHexColor(colors(background)[1] ?? "") ?? [0, 0, 0];
    const [wr, wg, wb] = lobe(waiting);
    expect(wr).toBeGreaterThan(wg);
    expect(wg).toBeGreaterThan(wb);
    const [er, eg, eb] = lobe(error);
    expect(er).toBeGreaterThan(eg * 1.5);
    expect(er).toBeGreaterThan(eb);
  });

  it("leaves untinted states identical", () => {
    const brand = AGENT_BRANDS["claude-code"];
    expect(orbPosterBackground(brand, "thinking")).toBe(orbPosterBackground(brand, "idle"));
  });
});

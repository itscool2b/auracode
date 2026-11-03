import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { companionVariant, WorkingCompanion } from "./WorkingCompanion";

/** A fixed sequence of draws, so a variant is chosen on purpose. */
const draws = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
};

describe("the working companion", () => {
  it("pairs a sea lion with leaps and rolls and a turtle with glides and paddles", () => {
    expect(companionVariant(draws(0, 0.5, 0, 0))).toEqual({
      kind: "seal",
      path: "porpoise",
      heading: "right",
      pace: 0.85,
    });
    expect(companionVariant(draws(0.9, 0.99, 0.9, 0.99))).toEqual({
      kind: "turtle",
      path: "dip",
      heading: "left",
      pace: 1.2,
    });
  });

  it("swims differently from turn to turn", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const variant = companionVariant();
      seen.add(`${variant.kind}:${variant.path}:${variant.heading}`);
      if (variant.kind === "seal") expect(["cruise", "porpoise", "roll"]).toContain(variant.path);
      else expect(["glide", "bob", "dip"]).toContain(variant.path);
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  it("is decorative ink, never a glow", () => {
    const html = renderToStaticMarkup(
      <WorkingCompanion variant={{ kind: "turtle", path: "glide", heading: "left", pace: 1 }} />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-kind="turtle"');
    expect(html).toContain('data-heading="left"');
    expect(html).not.toMatch(/glow|radial-gradient/);
  });
});

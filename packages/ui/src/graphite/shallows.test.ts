import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Creature, creatureHeight } from "./Creature";
import {
  buildCreaturePaths,
  CREATURE_GAPS,
  distance,
  inside,
  type Point,
  SEAL_SPEC,
  TURTLE_SPEC,
} from "./creatureGeometry";
import * as paths from "./creaturePaths";
import graphiteCss from "./graphite.css?raw";
import * as graphite from "./index";
import { Shallows } from "./Shallows";
import { Swimmers } from "./Swimmers";
import { ease, GAITS, giveWay, type SwimmerSpec, swimPose, swumDistance } from "./swim";
import { GRAPHITE_COLORS, relativeLuminance } from "./tokens";

const built = buildCreaturePaths();

describe("seal and turtle silhouettes", () => {
  it("ship exactly what creatureGeometry draws (run scripts/creature-paths.ts after a change)", () => {
    expect(paths.SEAL_PATH).toBe(built.seal.path);
    expect(paths.SEAL_SMALL_PATH).toBe(built.sealSmall.path);
    expect(paths.TURTLE_PATH).toBe(built.turtle.path);
    expect(paths.TURTLE_SMALL_PATH).toBe(built.turtleSmall.path);
    expect(paths.SEAL_VIEWBOX).toEqual(SEAL_SPEC.viewBox);
    expect(paths.TURTLE_VIEWBOX).toEqual(TURTLE_SPEC.viewBox);
  });

  it("are single even-odd paths of absolute M, C and Z commands inside their viewBox", () => {
    for (const [d, [w, h]] of [
      [paths.SEAL_PATH, paths.SEAL_VIEWBOX],
      [paths.SEAL_SMALL_PATH, paths.SEAL_VIEWBOX],
      [paths.TURTLE_PATH, paths.TURTLE_VIEWBOX],
      [paths.TURTLE_SMALL_PATH, paths.TURTLE_VIEWBOX],
    ] as const) {
      expect(d).toMatch(/^M/);
      expect(d.replace(/[MCZ]|-?\d+(?:\.\d+)?|\s/g, "")).toBe("");
      const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i < numbers.length; i += 2) {
        expect(numbers[i]).toBeGreaterThanOrEqual(0);
        expect(numbers[i]).toBeLessThanOrEqual(w);
        expect(numbers[i + 1]).toBeGreaterThanOrEqual(0);
        expect(numbers[i + 1]).toBeLessThanOrEqual(h);
      }
    }
  });

  it("keep every flipper, the head and the tail off the body by the gap, never touching it", () => {
    for (const [creature, gap, limbs] of [
      [built.seal, CREATURE_GAPS.seal, 3],
      [built.sealSmall, CREATURE_GAPS.sealSmall, 3],
      [built.turtle, CREATURE_GAPS.turtle, 6],
      [built.turtleSmall, CREATURE_GAPS.turtleSmall, 6],
    ] as const) {
      const body = creature.body.slice(0, -1);
      expect(creature.parts).toHaveLength(limbs);
      for (const part of creature.parts) {
        for (const point of part) {
          expect(inside(body, point)).toBe(false);
          expect(distance(body, point)).toBeGreaterThan(gap * 0.85);
        }
      }
    }
  });

  it("keep the limbs apart from one another", () => {
    for (const creature of [built.seal, built.turtle]) {
      creature.parts.forEach((part, i) => {
        creature.parts.forEach((other, j) => {
          if (i === j) return;
          const ring = other.slice(0, -1) as Point[];
          for (const point of part) expect(inside(ring, point)).toBe(false);
        });
      });
    }
  });

  it("draw the small variants with wider gaps for 64px and below", () => {
    expect(CREATURE_GAPS.sealSmall).toBeGreaterThan(CREATURE_GAPS.seal * 2);
    expect(CREATURE_GAPS.turtleSmall).toBeGreaterThan(CREATURE_GAPS.turtle * 1.9);
    const small = renderToString(createElement(Creature, { kind: "seal", size: 48 }));
    const large = renderToString(createElement(Creature, { kind: "seal", size: 330 }));
    expect(small).toContain(paths.SEAL_SMALL_PATH.slice(0, 40));
    expect(large).toContain(paths.SEAL_PATH.slice(0, 40));
    expect(small).toContain('width="48" height="20"');
  });
});

describe("Creature", () => {
  it("is decorative by default and an image when labelled", () => {
    const quiet = renderToString(createElement(Creature, { kind: "turtle", size: 120 }));
    expect(quiet).toMatch(/^<svg class="g-creature"/);
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).toContain('fill="currentColor"');
    const named = renderToString(
      createElement(Creature, { kind: "turtle", size: 120, label: "A sea turtle" }),
    );
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="A sea turtle"');
  });

  it("fills its parent without a size, and mirrors when facing left", () => {
    const html = renderToString(createElement(Creature, { kind: "seal", facing: "left" }));
    expect(html).not.toContain("width=");
    expect(html).toContain('data-facing="left"');
    expect(creatureHeight("turtle", 240)).toBe(220);
    expect(graphiteCss).toMatch(
      /\.g-creature:where\(\[data-facing="left"\]\) \{\s*transform: scaleX\(-1\);/,
    );
  });
});

const TURTLE: SwimmerSpec = { kind: "turtle", x: 0.2, y: 0.3, size: 240, depth: 0.1 };
const SEAL: SwimmerSpec = { kind: "seal", x: 0.8, y: 0.2, size: 320, heading: "left", phase: 7 };

describe("swimming", () => {
  it("starts every creature exactly at its anchor, so the server frame is the first frame", () => {
    for (const spec of [TURTLE, SEAL, { ...SEAL, tilt: -6 }]) {
      const pose = swimPose(spec, 0, 1416, 320);
      expect(pose.dx).toBeCloseTo(0, 9);
      expect(pose.dy).toBeCloseTo(0, 9);
      expect(Math.abs(pose.rotate - (spec.tilt ?? 0))).toBeLessThan(8);
      const html = renderToString(createElement(Swimmers, { swimmers: [spec] }));
      expect(html).toContain(`transform:rotate(${pose.rotate.toFixed(3)}deg)`);
    }
  });

  it("only ever moves forward, its speed eased between a glide and a surge", () => {
    for (const spec of [TURTLE, SEAL]) {
      const gait = GAITS[spec.kind];
      let previous = swumDistance(spec, 0);
      for (let t = 1 / 60; t < 120; t += 1 / 60) {
        const now = swumDistance(spec, t);
        const speed = (now - previous) * 60;
        expect(speed).toBeGreaterThan(gait.speed * (1 - gait.surge) * 0.98);
        expect(speed).toBeLessThan(gait.speed * (1 + gait.surge) * 1.02);
        previous = now;
      }
    }
  });

  it("never jitters: frame to frame it moves a few px and turns a fraction of a degree", () => {
    const width = 1416;
    for (const spec of [TURTLE, SEAL]) {
      let previous = swimPose(spec, 0, width, 320);
      for (let t = 1 / 60; t < 240; t += 1 / 60) {
        const pose = swimPose(spec, t, width, 320);
        const jump = Math.abs(pose.dx - previous.dx);
        const anchor = spec.x * width;
        // The one discontinuity is the wrap, and it happens only out of sight.
        if (jump > 2) {
          const at = anchor + previous.dx;
          expect(at < -160 || at > width + 160).toBe(true);
        } else {
          expect(Math.abs(pose.dy - previous.dy)).toBeLessThan(0.2);
          expect(Math.abs(pose.rotate - previous.rotate)).toBeLessThan(0.08);
        }
        expect(Math.abs(pose.rotate - (spec.tilt ?? 0))).toBeLessThan(8);
        previous = pose;
      }
    }
  });

  it("swims fully out of sight before it comes back on the other side", () => {
    const width = 1000;
    const extent = 300;
    let leftEdge = Number.POSITIVE_INFINITY;
    let rightEdge = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < 600; t += 0.25) {
      const x = 0.5 * width + swimPose({ ...TURTLE, x: 0.5 }, t, width, extent).dx;
      leftEdge = Math.min(leftEdge, x + extent / 2);
      rightEdge = Math.max(rightEdge, x - extent / 2);
    }
    expect(leftEdge).toBeLessThan(0);
    expect(rightEdge).toBeGreaterThan(width);
  });

  it("gives way to the pointer through a smooth field with no flip under the pointer", () => {
    expect(giveWay(100, 100, 100, 100)).toEqual({ x: 0, y: 0 });
    const far = giveWay(0, 0, 1000, 0);
    expect(Math.abs(far.x)).toBeLessThan(0.01);
    let peak = 0;
    let previous = giveWay(-300, 0, 0, 0).x;
    for (let x = -300; x <= 300; x += 1) {
      const away = giveWay(x, 0, 0, 0);
      peak = Math.max(peak, Math.hypot(away.x, away.y));
      expect(Math.abs(away.x - previous)).toBeLessThan(0.5);
      previous = away.x;
    }
    expect(peak).toBeLessThanOrEqual(22.001);
    expect(peak).toBeGreaterThan(21.5);
  });

  it("eases toward a target without overshooting", () => {
    let value = 0;
    for (let i = 0; i < 120; i++) {
      const next = ease(value, 20, 1 / 60, 0.9);
      expect(next).toBeGreaterThan(value);
      expect(next).toBeLessThan(20);
      value = next;
    }
    expect(ease(5, 5, 1 / 60, 0.9)).toBe(5);
  });
});

describe("Shallows and Swimmers render on a server", () => {
  it("renders the lit panel with its light layer and content", () => {
    const html = renderToString(
      createElement(
        Shallows,
        { as: "section", shimmer: true, className: "hero", depth: "720px" },
        "Hi",
      ),
    );
    expect(html).toMatch(/^<section class="g-shallows hero" data-shimmer=""/);
    expect(html).toContain("--g-shallows-depth:720px");
    expect(html).toContain('<span class="g-shallows-light" aria-hidden="true"></span>Hi');
    expect(renderToString(createElement(Shallows, null))).not.toContain("data-shimmer");
  });

  it("places each creature at its anchor, hidden from assistive technology", () => {
    const html = renderToString(
      createElement(Swimmers, {
        swimmers: [TURTLE, { ...SEAL, size: "clamp(96px, 20vw, 320px)" }],
      }),
    );
    expect(html).toMatch(/^<div class="g-swimmers" aria-hidden="true">/);
    expect(html).toContain("--g-swimmer-x:20%;--g-swimmer-y:30%;--g-swimmer-w:240px");
    expect(html).toContain("--g-swimmer-w:clamp(96px, 20vw, 320px)");
    expect(html).toContain('data-kind="seal"');
    expect(html).toContain('data-facing="left"');
    expect(html.match(/class="g-swimmer"/g)).toHaveLength(2);
    expect(html).toContain("data-far");
  });

  it("is exported from the Graphite entry point", () => {
    expect(graphite.Shallows).toBe(Shallows);
    expect(graphite.Swimmers).toBe(Swimmers);
    expect(graphite.Creature).toBe(Creature);
    expect(graphite.SEAL_PATH).toBe(paths.SEAL_PATH);
  });
});

describe("Shallows tokens and styles", () => {
  it("falls from the surface grey to the deep grey, silhouettes darker than the water", () => {
    const steps = [
      "water-surface",
      "water-shallow",
      "water-mid",
      "water-low",
      "water-deep",
    ] as const;
    for (let i = 1; i < steps.length; i++) {
      const lighter = GRAPHITE_COLORS[steps[i - 1] as (typeof steps)[number]];
      const darker = GRAPHITE_COLORS[steps[i] as (typeof steps)[number]];
      expect(relativeLuminance(darker)).toBeLessThan(relativeLuminance(lighter));
    }
    expect(relativeLuminance(GRAPHITE_COLORS["shade-near"])).toBeLessThan(
      relativeLuminance(GRAPHITE_COLORS["water-mid"]),
    );
    expect(relativeLuminance(GRAPHITE_COLORS["shade-far"])).toBeLessThan(
      relativeLuminance(GRAPHITE_COLORS["water-shallow"]),
    );
  });

  it("animates only transform, and holds still under reduced motion", () => {
    const section = graphiteCss.slice(graphiteCss.indexOf("Shallows and Swimmers (4.16)"));
    const keyframes = section.match(/@keyframes g-caustic \{[\s\S]*?\n\}/g) ?? [];
    expect(keyframes).toHaveLength(1);
    for (const block of keyframes) {
      const properties = [...block.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      expect(new Set(properties)).toEqual(new Set(["transform"]));
    }
    expect(section).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
    expect(section).toContain("pointer-events: none");
  });
});

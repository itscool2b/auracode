import { describe, expect, it } from "vitest";
import { cornerGeometry, DEFAULT_SMOOTHING, squircleClipPath, squirclePath } from "./squircle";

interface Command {
  readonly op: string;
  readonly args: readonly number[];
}

function parse(path: string): Command[] {
  const commands: Command[] = [];
  for (const match of path.matchAll(/([MLCAHVZ])([^MLCAHVZ]*)/g)) {
    const body = (match[2] ?? "").trim();
    commands.push({
      op: match[1] ?? "",
      args: body === "" ? [] : body.split(/[\s,]+/).map(Number),
    });
  }
  return commands;
}

/** Every point a command passes through or uses as a control point. */
function points(command: Command): Array<[number, number]> {
  const a = command.args;
  switch (command.op) {
    case "M":
    case "L":
      return [[a[0] ?? Number.NaN, a[1] ?? Number.NaN]];
    case "C":
      return [
        [a[0] ?? Number.NaN, a[1] ?? Number.NaN],
        [a[2] ?? Number.NaN, a[3] ?? Number.NaN],
        [a[4] ?? Number.NaN, a[5] ?? Number.NaN],
      ];
    case "A":
      return [[a[5] ?? Number.NaN, a[6] ?? Number.NaN]];
    default:
      return [];
  }
}

const SIZES: ReadonlyArray<readonly [number, number, number]> = [
  [320, 200, 16],
  [48, 48, 12],
  [600, 44, 22],
  [100, 100, 50],
  [37.5, 91.25, 9],
];

describe("squirclePath", () => {
  it("starts with M and is closed with Z", () => {
    for (const [w, h, r] of SIZES) {
      const path = squirclePath(w, h, r);
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
    }
  });

  it("ends its last curve exactly where it started", () => {
    for (const [w, h, r] of SIZES) {
      const commands = parse(squirclePath(w, h, r));
      const start = points(commands[0] as Command)[0];
      const drawing = commands.filter((c) => c.op !== "Z");
      const last = points(drawing[drawing.length - 1] as Command).at(-1);
      expect(last).toEqual(start);
    }
  });

  it("keeps every point and control point inside the box", () => {
    for (const [w, h, r] of SIZES) {
      for (const command of parse(squirclePath(w, h, r))) {
        for (const [x, y] of points(command)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(h);
        }
      }
    }
  });

  it("draws four corners, each turning clockwise", () => {
    const commands = parse(squirclePath(320, 200, 16));
    const arcs = commands.filter((c) => c.op === "A");
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) {
      // rx ry rotation large-arc sweep x y
      expect(arc.args.slice(0, 5)).toEqual([16, 16, 0, 0, 1]);
    }
    expect(commands.filter((c) => c.op === "C")).toHaveLength(8);
  });

  it("clamps the radius to half the shorter side", () => {
    expect(squirclePath(200, 80, 1000)).toBe(squirclePath(200, 80, 40));
    expect(squirclePath(200, 80, Number.POSITIVE_INFINITY)).toBe(squirclePath(200, 80, 40));
  });

  it("gives up smoothing before radius, so a maxed-out radius makes a true pill", () => {
    const pill = squirclePath(200, 80, 40, 0.6);
    expect(pill).toBe(squirclePath(200, 80, 40, 0));
    expect(parse(pill).filter((c) => c.op === "C")).toHaveLength(0);
  });

  it("returns a plain rect path for zero, negative, and non-finite sizes", () => {
    expect(squirclePath(0, 50, 10)).toBe("M0 0H0V50H0Z");
    expect(squirclePath(-5, -5, 2)).toBe("M0 0H0V0H0Z");
    expect(squirclePath(Number.NaN, 20, 4)).toBe("M0 0H0V20H0Z");
    expect(squirclePath(Number.POSITIVE_INFINITY, 10, 2)).toBe("M0 0H0V10H0Z");
    expect(squirclePath(40, Number.NaN, 2)).toBe("M0 0H40V0H0Z");
  });

  it("returns a plain rect of the real size for a zero, negative, or NaN radius", () => {
    expect(squirclePath(120, 60, 0)).toBe("M0 0H120V60H0Z");
    expect(squirclePath(120, 60, -8)).toBe("M0 0H120V60H0Z");
    expect(squirclePath(120, 60, Number.NaN)).toBe("M0 0H120V60H0Z");
  });

  it("clamps smoothing to 0..1 and treats NaN as the default", () => {
    expect(squirclePath(100, 100, 20, 3)).toBe(squirclePath(100, 100, 20, 1));
    expect(squirclePath(100, 100, 20, -2)).toBe(squirclePath(100, 100, 20, 0));
    expect(squirclePath(100, 100, 20, Number.NaN)).toBe(
      squirclePath(100, 100, 20, DEFAULT_SMOOTHING),
    );
    expect(squirclePath(100, 100, 20)).toBe(squirclePath(100, 100, 20, DEFAULT_SMOOTHING));
  });

  it("never prints NaN, Infinity, or exponents", () => {
    const awkward = [0.001, 1e-7, 3, 7.777, 1e6, Number.NaN, -1, Number.POSITIVE_INFINITY];
    for (const w of awkward) {
      for (const h of awkward) {
        for (const r of awkward) {
          expect(squirclePath(w, h, r, 0.6)).not.toMatch(/NaN|Infinity|e[+-]?\d/);
        }
      }
    }
  });

  it("wraps as a CSS clip-path value", () => {
    expect(squircleClipPath(48, 48, 12)).toBe(`path("${squirclePath(48, 48, 12)}")`);
  });
});

describe("cornerGeometry", () => {
  it("starts the corner (1 + s)R along each edge", () => {
    const g = cornerGeometry(10, 0.6, 100);
    expect(g.p).toBeCloseTo(16, 10);
    expect(g.smoothing).toBe(0.6);
  });

  it("is curvature-continuous where each Bezier meets the arc", () => {
    for (const s of [0.1, 0.35, 0.6, 0.85, 1]) {
      const r = 10;
      const { b, c, d } = cornerGeometry(r, s, 1000);
      // Bezier end curvature: (2/3) |(P2 - P1) x (P3 - P2)| / |P3 - P2|^3, with P2 - P1 = (b, 0)
      // and P3 - P2 = (c, d).
      const curvature = ((2 / 3) * b * d) / (c * c + d * d) ** 1.5;
      expect(curvature).toBeCloseTo(1 / r, 6);
    }
  });

  it("is tangent-continuous: the last leg is perpendicular to the arc's radius", () => {
    const r = 10;
    const s = 0.6;
    const { c, d, arc } = cornerGeometry(r, s, 1000);
    // Arc start relative to the corner circle's centre at (-r, r) in corner-local coordinates.
    const toPoint = [-(arc + d) + r, d - r] as const;
    expect(Math.hypot(toPoint[0], toPoint[1])).toBeCloseTo(r, 10);
    expect(c * toPoint[0] + d * toPoint[1]).toBeCloseTo(0, 10);
  });

  it("has no negative lengths anywhere in the smoothing range", () => {
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const g = cornerGeometry(12, s, 1000);
      for (const value of [g.p, g.a, g.b, g.c, g.d, g.arc]) expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("collapses to nothing for a zero budget or radius", () => {
    expect(cornerGeometry(10, 0.6, 0).radius).toBe(0);
    expect(cornerGeometry(0, 0.6, 10).p).toBe(0);
  });
});

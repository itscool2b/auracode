import { describe, expect, it } from "vitest";
import agentMarkSource from "./AgentMark.tsx?raw";
import copySource from "./CopyButton.tsx?raw";
import graphiteCss from "./graphite.css?raw";
import keycapSource from "./Keycap.tsx?raw";
import markSource from "./Logo.tsx?raw";
import logoPathsSource from "./logoPaths.ts?raw";
import loaderSource from "./PixelLoader.tsx?raw";
import pixelsSource from "./pixels.ts?raw";
import statusSource from "./StatusDot.tsx?raw";
import {
  contrastRatio,
  GRAPHITE_COLORS,
  GRAPHITE_DURATIONS,
  GRAPHITE_EASINGS,
  GRAPHITE_LIGHT_COLORS,
  GRAPHITE_STAGGERS,
  relativeLuminance,
} from "./tokens";
import tokensCss from "./tokens.css?raw";
import tokensSource from "./tokens.ts?raw";

const REDUCED = "@media (prefers-reduced-motion: reduce)";
const [rootPart = "", reducedPart = ""] = tokensCss.split(REDUCED);

function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--g-[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim());
  }
  return found;
}

const root = declarations(rootPart.split(':root[data-theme="light"]')[0] ?? "");
const light = declarations(tokensCss.match(/:root\[data-theme="light"\] \{([^}]+)\}/)?.[1] ?? "");

function token(name: string): string {
  const value = root.get(`--g-${name}`);
  if (value === undefined) throw new Error(`--g-${name} is not declared in tokens.css`);
  return value;
}

const SURFACES = ["bg", "surface-1", "surface-2", "surface-3"] as const;

function channels(value: string): readonly [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (!rgb) throw new Error(`not a #rrggbb or rgb(r g b / a) colour: ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])];
}

/** `top` composited over the opaque `under`, as `#rrggbb`. */
function over(top: string, under: string): string {
  const [r, g, b, a] = channels(top);
  const [ur, ug, ub] = channels(under);
  return `#${[
    [r, ur],
    [g, ug],
    [b, ub],
  ]
    .map(([t = 0, u = 0]) =>
      Math.round(t * a + u * (1 - a))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("Graphite colour tokens", () => {
  it("declares every colour the TypeScript mirror knows, with the same value", () => {
    for (const [name, hex] of Object.entries(GRAPHITE_COLORS)) {
      expect(token(name).toLowerCase(), name).toBe(hex);
    }
    for (const [name, hex] of Object.entries(GRAPHITE_LIGHT_COLORS)) {
      expect(light.get(`--g-${name}`)?.toLowerCase(), `light ${name}`).toBe(hex);
    }
  });

  it("keeps light text, meaningful boundaries and focus readable", () => {
    const colors = GRAPHITE_LIGHT_COLORS;
    for (const surface of [...SURFACES, "surface-4"] as const) {
      for (const fg of ["fg-1", "fg-2", "fg-3", "volt", "green", "red", "warning"] as const) {
        expect(
          contrastRatio(colors[fg], colors[surface]),
          `${fg} on light ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const palette of [GRAPHITE_COLORS, GRAPHITE_LIGHT_COLORS]) {
      for (const surface of ["surface-1", "surface-2"] as const) {
        for (const role of ["outline", "focus"] as const) {
          expect(
            contrastRatio(palette[role], palette[surface]),
            `${role} on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
      for (const fill of ["primary", "primary-hover", "primary-active"] as const) {
        expect(contrastRatio(palette["on-light"], palette[fill]), fill).toBeGreaterThanOrEqual(4.5);
      }
      for (const status of ["green", "red", "warning"] as const) {
        expect(
          contrastRatio(palette[status], palette[`${status}-tint`]),
          status,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("writes every text colour as a solid six-digit hex, never with alpha", () => {
    const text = [...root.keys()].filter((name) =>
      /^--g-(fg-\d|on-light|volt|green|red|code-|ansi-|primary)/.test(name),
    );
    expect(text.length).toBeGreaterThan(20);
    for (const name of text) {
      if (name.endsWith("-tint")) continue;
      expect(root.get(name), name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps the tertiary grey at 4.5:1 or better on the page and surfaces 1 to 3", () => {
    for (const surface of SURFACES) {
      const ratio = contrastRatio(GRAPHITE_COLORS["fg-3"], GRAPHITE_COLORS[surface]);
      expect(ratio, `fg-3 on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    // #808080, the starting value, failed on surface-3 (4.45:1); the shipped grey keeps a margin.
    expect(contrastRatio("#808080", GRAPHITE_COLORS["surface-3"])).toBeLessThan(4.5);
    expect(contrastRatio(GRAPHITE_COLORS["fg-3"], GRAPHITE_COLORS["surface-3"])).toBeGreaterThan(
      4.7,
    );
  });

  it("keeps every other text colour readable on every surface it sits on", () => {
    for (const surface of [...SURFACES, "surface-4"] as const) {
      for (const fg of ["fg-1", "fg-2", "volt", "green", "red"] as const) {
        const ratio = contrastRatio(GRAPHITE_COLORS[fg], GRAPHITE_COLORS[surface]);
        expect(ratio, `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const name of [...root.keys()].filter((n) => /^--g-(code|ansi)-/.test(n))) {
      if (name === "--g-ansi-black" || name === "--g-code-bg") continue;
      const hex = root.get(name) ?? "";
      expect(contrastRatio(hex, GRAPHITE_COLORS["surface-1"]), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives filled controls dark labels that pass", () => {
    const onLight = GRAPHITE_COLORS["on-light"];
    for (const fill of [
      "primary",
      "primary-hover",
      "primary-active",
      "red",
      "red-hover",
    ] as const) {
      expect(contrastRatio(onLight, GRAPHITE_COLORS[fill]), fill).toBeGreaterThanOrEqual(4.5);
    }
    // White on the red pill would fail, which is why the destructive label is black.
    expect(contrastRatio("#ffffff", GRAPHITE_COLORS.red)).toBeLessThan(4.5);
  });

  it("orders the surface and text ladders", () => {
    const lum = (name: keyof typeof GRAPHITE_COLORS) => relativeLuminance(GRAPHITE_COLORS[name]);
    const surfaces = ["bg", "surface-1", "surface-2", "surface-3", "surface-4"] as const;
    for (let i = 1; i < surfaces.length; i++) {
      expect(lum(surfaces[i] ?? "bg")).toBeGreaterThan(lum(surfaces[i - 1] ?? "bg"));
    }
    expect(lum("fg-1")).toBeGreaterThan(lum("fg-2"));
    expect(lum("fg-2")).toBeGreaterThan(lum("fg-3"));
    expect(lum("fg-3")).toBeGreaterThan(lum("fg-4"));
  });

  it("keeps text readable on Halo glass over the worst plausible window material", () => {
    // A light Acrylic or Mica window is darkest over a black desktop, a dark one lightest over a
    // white desktop. The window tint, a layer and a popover stack on top of that, in that order.
    const cases = [
      { name: "light", palette: GRAPHITE_LIGHT_COLORS, tokens: light, material: "#d4d4d4" },
      { name: "dark", palette: GRAPHITE_COLORS, tokens: root, material: "#3a3a3a" },
    ] as const;
    for (const { name, palette, tokens, material } of cases) {
      const glass = (token: string) => {
        const value = tokens.get(`--g-${token}`);
        if (value === undefined) throw new Error(`--g-${token} is missing for ${name}`);
        return value;
      };
      const tinted = over(glass("window-tint"), material);
      const layer = over(glass("glass-layer"), tinted);
      const card = over(glass("glass-card"), layer);
      const bases = {
        tinted,
        layer,
        card,
        // A segmented track or a pill inside a grouped card.
        "control on card": over(glass("glass-control"), card),
        bar: over(glass("glass-bar"), layer),
        pop: over(glass("glass-pop"), layer),
        opaque: over(glass("glass-layer"), glass("window")),
      };
      for (const [baseName, base] of Object.entries(bases)) {
        for (const fg of ["fg-1", "fg-2", "fg-3"] as const) {
          expect(
            contrastRatio(palette[fg], base),
            `${name} ${fg} on ${baseName}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("measures contrast like WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(Number.isNaN(relativeLuminance("red"))).toBe(true);
  });
});

describe("Graphite motion tokens", () => {
  it("mirrors the durations, staggers and easings", () => {
    for (const [name, ms] of Object.entries(GRAPHITE_DURATIONS)) {
      expect(token(`dur-${name}`), name).toBe(`${ms}ms`);
    }
    expect(token("stagger")).toBe(`${GRAPHITE_STAGGERS.word}ms`);
    expect(token("stagger-letter")).toBe(`${GRAPHITE_STAGGERS.letter}ms`);
    expect(token("stagger-row")).toBe(`${GRAPHITE_STAGGERS.row}ms`);
    for (const [name, curve] of Object.entries(GRAPHITE_EASINGS)) {
      const property = name === "ease" ? "ease" : `ease-${name}`;
      expect(token(property).split(" /*")[0], property).toBe(`cubic-bezier(${curve.join(", ")})`);
    }
  });

  it("keeps interface feedback brief and separates it from content cycling", () => {
    for (const key of ["micro", "fast", "base", "panel", "settle", "row", "headline"] as const) {
      expect(GRAPHITE_DURATIONS[key]).toBeGreaterThan(0);
      expect(GRAPHITE_DURATIONS[key]).toBeLessThanOrEqual(250);
    }
    expect(GRAPHITE_DURATIONS.timer).toBeGreaterThan(GRAPHITE_DURATIONS.panel);
  });

  it("stops movement under the OS setting and under the app's own setting alike", () => {
    const [mediaPart = "", appPart = ""] = reducedPart.split(':root:is([data-motion="reduced"]');
    const media = declarations(mediaPart);
    const app = declarations(appPart);
    const moving = ["letter", "panel", "row", "step", "headline", "reveal", "count", "glint"];
    for (const name of moving) {
      expect(media.get(`--g-dur-${name}`), `media ${name}`).toBe("0ms");
      expect(app.get(`--g-dur-${name}`), `app ${name}`).toBe("0ms");
    }
    for (const name of ["stagger", "stagger-letter", "stagger-row"]) {
      expect(media.get(`--g-${name}`), `media ${name}`).toBe("0ms");
      expect(app.get(`--g-${name}`), `app ${name}`).toBe("0ms");
    }
    // Reduced motion makes even small feedback transitions immediate.
    for (const name of ["micro", "fast", "base", "settle", "dim", "shimmer"]) {
      expect(media.get(`--g-dur-${name}`), name).toBe("0ms");
      expect(app.get(`--g-dur-${name}`), name).toBe("0ms");
    }
    expect(graphiteCss).toContain(REDUCED);
    expect(graphiteCss).toContain('[data-motion="off"]');
  });
});

describe("Graphite stylesheet rules", () => {
  it("imports the tokens and keeps type to integer weights 400, 500 and 600", () => {
    expect(graphiteCss).toContain('@import "./tokens.css";');
    for (const match of graphiteCss.matchAll(/font-weight:\s*([^;]+);/g)) {
      expect(["400", "500", "600"]).toContain((match[1] ?? "").trim());
    }
    for (const match of tokensCss.matchAll(/--g-weight-[\w-]+:\s*([^;]+);/g)) {
      expect(["400", "500", "600"]).toContain((match[1] ?? "").trim());
    }
  });

  it("never transitions all properties and never animates layout", () => {
    expect(graphiteCss).not.toMatch(/transition:\s*all/);
    for (const match of graphiteCss.matchAll(/transition:([^;]+);/g)) {
      const value = match[1] ?? "";
      for (const property of ["width", "height", "top", "left", "margin", "padding"]) {
        expect(value, value).not.toMatch(new RegExp(`(^|[\\s,])${property}\\s`));
      }
    }
  });

  it("blurs and shadows only through the Halo glass tokens", () => {
    // The one filter blur is depth: a far swimmer is softened once, at raster time (4.16).
    const depth =
      /\.g-swimmer:where\(\[data-far\]\) > \.g-creature \{\s*filter: blur\(calc\(var\(--g-swimmer-depth\) \* [\d.]+px\)\);\s*\}/;
    expect(graphiteCss).toMatch(depth);
    const rest = graphiteCss.replace(depth, "");
    expect(rest).not.toMatch(/[^-]filter:\s*blur|drop-shadow|text-shadow/);
    const blurs = [...rest.matchAll(/(-webkit-)?backdrop-filter:([^;]+);/g)];
    expect(blurs.length).toBeGreaterThan(0);
    for (const [, prefix, value] of blurs) {
      expect(value?.trim(), `${prefix ?? ""}backdrop-filter`).toMatch(
        /^(var\(--g-blur-[\w-]+\)|none)$/,
      );
    }
    // Safari 16.4, the oldest WebKit the app supports, needs the prefixed property alongside.
    expect(blurs.filter(([, prefix]) => prefix).length).toBe(
      blurs.filter(([, prefix]) => !prefix).length,
    );
    const part = /^(var\(--g-shadow(-[\w-]+)?\)|inset 0 0 0 1px [^,]+|inset 0 1px 0 [^,]+|none)$/;
    for (const match of rest.matchAll(/box-shadow:([^;]+);/g)) {
      for (const layer of (match[1] ?? "").split(/,(?![^(]*\))/)) {
        expect(layer.replace(/\s+/g, " ").trim(), match[1]).toMatch(part);
      }
    }
  });

  it("keeps component rules to one class, with states inside :where()", () => {
    const selectors = graphiteCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "")
      .match(/(^|\})\s*([^{}@]+)\{/g);
    expect(selectors?.length ?? 0).toBeGreaterThan(100);
    for (const raw of selectors ?? []) {
      const list = raw.replace(/^\}?\s*/, "").replace(/\{$/, "");
      for (const selector of list.split(/,(?![^(]*\))/)) {
        const bare = selector.replace(/:where\([^)]*\)/g, "").replace(/::?[\w-]+(\([^)]*\))?/g, "");
        const classes = bare.match(/\.[\w-]+/g) ?? [];
        // A few deliberate contextual rules (keycap on the white pill) hold two classes.
        expect(classes.length, selector.trim()).toBeLessThanOrEqual(2);
      }
    }
  });

  it("contains no em dash in any Graphite source", () => {
    const sources = {
      agentMarkSource,
      copySource,
      graphiteCss,
      keycapSource,
      loaderSource,
      logoPathsSource,
      markSource,
      pixelsSource,
      statusSource,
      tokensCss,
      tokensSource,
    };
    for (const [name, text] of Object.entries(sources)) {
      expect(text.includes(String.fromCharCode(0x2014)), name).toBe(false);
    }
  });
});

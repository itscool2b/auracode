import instrumentSerifItalicCss from "@fontsource/instrument-serif/400-italic.css?raw";
import instrumentSerifCss from "@fontsource/instrument-serif/index.css?raw";
import geistCss from "@fontsource-variable/geist/index.css?raw";
import geistMonoCss from "@fontsource-variable/geist-mono/index.css?raw";
import { describe, expect, it } from "vitest";
import { AGENT_BRAND_IDS, AGENT_BRANDS, type AgentBrand, brandCssVariables } from "./brand";
import fontsCss from "./fonts.css?raw";
import { durations, easings } from "./motion";
import { radii, zIndex } from "./tokens";
import tokensCss from "./tokens.css?raw";

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const [rootPart = "", reducedPart = ""] = tokensCss.split(REDUCED_MOTION);

/** Every custom property declared in a chunk of CSS, last declaration winning. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim());
  }
  return found;
}

const root = declarations(rootPart);
const reduced = declarations(reducedPart);

function value(name: string): string {
  const found = root.get(name);
  if (found === undefined) throw new Error(`${name} is not declared in tokens.css`);
  return found;
}

/**
 * The custom-property cascade on one element, as engines compute it: a property declared on the
 * element has its var() references substituted from the element's own computed values, while any
 * other property inherits the parent's computed value as is, already substituted. The second rule
 * is why a token derived on :root keeps the root's accent below an element that overrides it.
 * Throws on a reference to an undeclared property or on a cycle, both bugs in a token sheet.
 */
function cascade(
  parent: ReadonlyMap<string, string>,
  declared: Readonly<Record<string, string>>,
): Map<string, string> {
  const computed = new Map(parent);
  const pending = new Set(Object.keys(declared));
  const resolving = new Set<string>();
  const resolve = (name: string): string => {
    if (!pending.has(name)) {
      const inherited = computed.get(name);
      if (inherited === undefined) throw new Error(`var(${name}) refers to an undeclared property`);
      return inherited;
    }
    if (resolving.has(name)) throw new Error(`var() cycle through ${name}`);
    resolving.add(name);
    const resolved = (declared[name] ?? "").replace(/var\((--[\w-]+)\)/g, (_, ref: string) =>
      resolve(ref),
    );
    resolving.delete(name);
    pending.delete(name);
    computed.set(name, resolved);
    return resolved;
  };
  for (const name of Object.keys(declared)) resolve(name);
  return computed;
}

describe("tokens.css", () => {
  it("declares the core Aura tokens", () => {
    const required = [
      "--aura-base",
      "--aura-text-1",
      "--aura-text-2",
      "--aura-text-3",
      "--aura-text-4",
      "--aura-fill-1",
      "--aura-fill-2",
      "--aura-fill-3",
      "--aura-hairline",
      "--aura-border-1",
      "--aura-shadow-1",
      "--aura-shadow-2",
      "--aura-shadow-3",
      "--aura-accent",
      "--aura-accent-2",
      "--aura-glow",
      "--aura-blur-overlay",
      "--aura-blur-field",
      "--aura-ease-spring",
      "--aura-overlay-scrim",
    ];
    for (const name of required) expect(root.has(name), name).toBe(true);
  });

  it("declares three complete elevations", () => {
    for (const level of [1, 2, 3]) {
      for (const part of ["fill", "hairline-top", "hairline-bottom", "highlight", "shadow"]) {
        expect(root.has(`--aura-elev-${level}-${part}`), `elevation ${level} ${part}`).toBe(true);
      }
    }
  });

  it("uses translucent whites for surfaces, to sit on the native window glass", () => {
    for (const name of ["--aura-fill-1", "--aura-fill-2", "--aura-fill-3", "--aura-elev-1-fill"]) {
      expect(value(name)).toMatch(/^rgb\(255 255 255 \/ 0?\.\d+\)$/);
    }
  });

  it("matches the JS radii", () => {
    for (const [name, px] of Object.entries(radii)) {
      expect(value(`--aura-radius-${name}`)).toBe(`${px}px`);
    }
  });

  it("matches the JS z layers", () => {
    for (const [name, layer] of Object.entries(zIndex)) {
      expect(value(`--aura-z-${name}`)).toBe(String(layer));
    }
  });

  it("matches the JS durations and easings", () => {
    for (const [name, ms] of Object.entries(durations)) {
      expect(value(`--aura-duration-${name}`)).toBe(`${ms}ms`);
    }
    const kebab: Record<string, string> = { inOut: "in-out" };
    for (const [name, curve] of Object.entries(easings)) {
      expect(value(`--aura-ease-${kebab[name] ?? name}`)).toBe(`cubic-bezier(${curve.join(", ")})`);
    }
  });

  it("defaults the accent to the generic brand, in both the root and @property", () => {
    const generic = AGENT_BRANDS.generic;
    expect(value("--aura-accent")).toBe(generic.accent);
    expect(value("--aura-accent-2")).toBe(generic.palette[1]);
    expect(value("--aura-glow")).toBe(generic.glow);
    for (const [name, color] of [
      ["--aura-accent", generic.accent],
      ["--aura-accent-2", generic.palette[1]],
      ["--aura-glow", generic.glow],
    ] as const) {
      const block = new RegExp(`@property ${name} \\{[^}]*initial-value: ([^;]+);`).exec(tokensCss);
      expect(block?.[1], name).toBe(color);
    }
  });

  it("makes movement instant under reduced motion but keeps opacity fades", () => {
    expect(tokensCss).toContain(REDUCED_MOTION);
    for (const name of ["instant", "fast", "base", "slow", "slower", "ambient"]) {
      expect(reduced.get(`--aura-duration-${name}`), name).toBe("1ms");
    }
    const fade = Number.parseFloat(reduced.get("--aura-duration-fade") ?? "0");
    expect(fade).toBeGreaterThan(1);
    expect(reduced.get("--aura-rise-distance")).toBe("0px");
  });
});

describe("tokens.css under an agent's brand", () => {
  const rootDeclared = Object.fromEntries(root);
  const rootComputed = cascade(new Map(), rootDeclared);

  /** Every token as :root itself would compute it, had the brand's colours been the defaults. */
  function rootedIn(brand: AgentBrand): Map<string, string> {
    return cascade(new Map(), {
      ...rootDeclared,
      "--aura-accent": brand.accent,
      "--aura-accent-2": brand.palette[1],
      "--aura-glow": brand.glow,
    });
  }

  it("gives a control inside a tinted element the brand's focus ring and soft accent", () => {
    const brand = AGENT_BRANDS["claude-code"];
    const fallback = AGENT_BRANDS.generic.accent;
    // The control declares nothing of its own, so it inherits whatever the tinted element computed.
    const control = cascade(cascade(rootComputed, brandCssVariables(brand)), {});
    for (const name of ["--aura-focus-ring", "--aura-accent-soft"]) {
      expect(control.get(name), name).toContain(brand.accent);
      expect(control.get(name), name).not.toContain(fallback);
    }
  });

  it("re-derives every token inside an element tinted with brandCssVariables", () => {
    for (const id of AGENT_BRAND_IDS) {
      const brand = AGENT_BRANDS[id];
      const expected = rootedIn(brand);
      const control = cascade(cascade(rootComputed, brandCssVariables(brand)), {});
      for (const name of root.keys()) {
        expect(control.get(name), `${id}: ${name}`).toBe(expected.get(name));
      }
    }
  });

  it("re-derives them again under a tint nested inside another", () => {
    const outer = cascade(rootComputed, brandCssVariables(AGENT_BRANDS.codex));
    for (const id of AGENT_BRAND_IDS) {
      const brand = AGENT_BRANDS[id];
      const expected = rootedIn(brand);
      const inner = cascade(outer, brandCssVariables(brand));
      for (const name of root.keys()) {
        expect(inner.get(name), `${id}: ${name}`).toBe(expected.get(name));
      }
    }
  });

  it("sets only properties that tokens.css declares", () => {
    for (const name of Object.keys(brandCssVariables(AGENT_BRANDS.generic))) {
      expect(root.has(name), name).toBe(true);
    }
  });
});

describe("fonts.css", () => {
  it("imports the three bundled font packages", () => {
    expect(fontsCss).toContain('@import "@fontsource-variable/geist";');
    expect(fontsCss).toContain('@import "@fontsource-variable/geist-mono";');
    expect(fontsCss).toContain('@import "@fontsource/instrument-serif";');
    expect(fontsCss).toContain('@import "@fontsource/instrument-serif/400-italic.css";');
  });

  it("names the families exactly as the packages register them", () => {
    const fonts = declarations(fontsCss);
    const family = (name: string) => /^"([^"]+)"/.exec(fonts.get(name) ?? "")?.[1] ?? "";
    expect(geistCss).toContain(`font-family: '${family("--font-sans")}'`);
    expect(geistMonoCss).toContain(`font-family: '${family("--font-mono")}'`);
    expect(instrumentSerifCss).toContain(`font-family: '${family("--font-display")}'`);
    expect(instrumentSerifItalicCss).toContain("font-style: italic");
  });

  it("ends every stack in a generic family", () => {
    const fonts = declarations(fontsCss);
    expect(fonts.get("--font-sans")).toMatch(/sans-serif$/);
    expect(fonts.get("--font-mono")).toMatch(/monospace$/);
    expect(fonts.get("--font-display")).toMatch(/serif$/);
  });
});

import { describe, expect, it } from "vitest";
import {
  AGENT_BRAND_IDS,
  AGENT_BRANDS,
  type AgentBrandId,
  brandCssVariables,
  brandsEqual,
  getBrand,
  monogram,
} from "./brand";
import { parseHexColor } from "./color";

const HEX = /^#[0-9a-f]{6}$/;

function luminance(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`bad colour ${hex}`);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe("brands", () => {
  it("lists every brand once, keyed by its own id", () => {
    expect(new Set(AGENT_BRAND_IDS).size).toBe(AGENT_BRAND_IDS.length);
    expect(Object.keys(AGENT_BRANDS).sort()).toEqual([...AGENT_BRAND_IDS].sort());
    for (const id of AGENT_BRAND_IDS) expect(AGENT_BRANDS[id].id).toBe(id);
  });

  it("has well-formed colours and motion for every brand", () => {
    for (const id of AGENT_BRAND_IDS) {
      const brand = AGENT_BRANDS[id];
      expect(brand.palette).toHaveLength(4);
      for (const color of [...brand.palette, brand.accent, brand.glow]) expect(color).toMatch(HEX);
      expect(brand.motion.speed).toBeGreaterThan(0);
      expect(brand.motion.turbulence).toBeGreaterThanOrEqual(0);
      expect(brand.motion.turbulence).toBeLessThanOrEqual(1);
      expect(brand.motion.ringFrequency).toBeGreaterThan(0);
      for (const component of brand.motion.drift) expect(Number.isFinite(component)).toBe(true);
    }
  });

  it("orders every palette from darkest to brightest, as the shader's ramp expects", () => {
    for (const id of AGENT_BRAND_IDS) {
      const levels = AGENT_BRANDS[id].palette.map(luminance);
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i], `${id} stop ${i}`).toBeGreaterThan(levels[i - 1] ?? 0);
      }
    }
  });

  it("gives Antigravity its upward drift and Hermes the fastest pace", () => {
    expect(AGENT_BRANDS.antigravity.motion.drift[1]).toBeGreaterThan(0.1);
    const fastest = AGENT_BRAND_IDS.reduce((a, b) =>
      AGENT_BRANDS[a].motion.speed >= AGENT_BRANDS[b].motion.speed ? a : b,
    );
    expect(fastest).toBe("hermes");
  });

  it("keeps Claude Code in the terracotta family around #d97757", () => {
    expect(AGENT_BRANDS["claude-code"].accent).toBe("#d97757");
  });
});

describe("getBrand", () => {
  it("finds every brand by id", () => {
    for (const id of AGENT_BRAND_IDS) expect(getBrand(id)).toBe(AGENT_BRANDS[id]);
  });

  it("tolerates case, padding, spaces, underscores, and dots", () => {
    expect(getBrand("Claude Code").id).toBe("claude-code");
    expect(getBrand("CLAUDE_CODE").id).toBe("claude-code");
    expect(getBrand("  codex  ").id).toBe("codex");
    expect(getBrand("Oh.My.Pi").id).toBe("oh-my-pi");
  });

  it("resolves the names agents go by", () => {
    const cases: ReadonlyArray<readonly [string, AgentBrandId]> = [
      ["claude", "claude-code"],
      ["agy", "antigravity"],
      ["antigravity-acp", "antigravity"],
      ["omp", "oh-my-pi"],
      ["hermes-acp", "hermes"],
      ["grok-build", "grok"],
      ["cursor-agent", "cursor"],
    ];
    for (const [alias, id] of cases) expect(getBrand(alias).id).toBe(id);
  });

  it("falls back to generic for unknown ids", () => {
    expect(getBrand("gemini")).toBe(AGENT_BRANDS.generic);
    expect(getBrand("")).toBe(AGENT_BRANDS.generic);
    // Cursor's binary is literally `agent`; the plan forbids treating that name as Cursor.
    expect(getBrand("agent")).toBe(AGENT_BRANDS.generic);
  });

  it("never resolves prototype members", () => {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(getBrand(key)).toBe(AGENT_BRANDS.generic);
    }
  });

  it("survives non-string input from untyped callers", () => {
    expect(getBrand(undefined as unknown as string)).toBe(AGENT_BRANDS.generic);
    expect(getBrand(42 as unknown as string)).toBe(AGENT_BRANDS.generic);
  });
});

describe("brandsEqual", () => {
  it("compares by content, so rebuilt brand objects are equal", () => {
    const copy = {
      ...AGENT_BRANDS.codex,
      palette: [...AGENT_BRANDS.codex.palette] as const,
      motion: {
        ...AGENT_BRANDS.codex.motion,
        drift: [...AGENT_BRANDS.codex.motion.drift] as const,
      },
    };
    expect(copy).not.toBe(AGENT_BRANDS.codex);
    expect(brandsEqual(copy, AGENT_BRANDS.codex)).toBe(true);
  });

  it("notices any change in colour or motion", () => {
    const base = AGENT_BRANDS.codex;
    const variants = [
      { ...base, id: "generic" as const },
      { ...base, glow: "#000000" },
      { ...base, palette: [base.palette[0], base.palette[1], base.palette[2], "#000000"] as const },
      { ...base, motion: { ...base.motion, speed: 2 } },
      { ...base, motion: { ...base.motion, drift: [0, 0.5] as const } },
    ];
    for (const variant of variants) expect(brandsEqual(variant, base)).toBe(false);
    expect(brandsEqual(AGENT_BRANDS.pi, AGENT_BRANDS["oh-my-pi"])).toBe(false);
  });
});

describe("brandCssVariables", () => {
  it("maps accent, the deep companion tone, and glow", () => {
    const variables = brandCssVariables(AGENT_BRANDS.codex);
    expect(variables["--aura-accent"]).toBe("#b9c5d3");
    expect(variables["--aura-accent-2"]).toBe("#333b47");
    expect(variables["--aura-glow"]).toBe("#a9bcd0");
  });

  it("re-declares the accent-derived tokens, reading the accent of the element it tints", () => {
    const variables = brandCssVariables(AGENT_BRANDS["claude-code"]);
    expect(Object.keys(variables).sort()).toEqual([
      "--aura-accent",
      "--aura-accent-2",
      "--aura-accent-soft",
      "--aura-focus-ring",
      "--aura-glow",
    ]);
    // var(), not a baked hex, so the value tracks the accent on that element, mid-transition too.
    expect(variables["--aura-focus-ring"]).toContain("var(--aura-accent)");
    expect(variables["--aura-accent-soft"]).toContain("var(--aura-accent)");
  });
});

describe("monogram", () => {
  it("uses the initials of the first two words", () => {
    expect(monogram("Claude Code")).toBe("CC");
    expect(monogram("Gemini CLI")).toBe("GC");
    expect(monogram("oh-my-pi")).toBe("OM");
    expect(monogram("  claude   code  ")).toBe("CC");
    expect(monogram("one two three")).toBe("OT");
  });

  it("splits camel humps into words", () => {
    expect(monogram("OpenCode")).toBe("OC");
    expect(monogram("openCode")).toBe("OC");
  });

  it("uses one letter for a single word", () => {
    expect(monogram("codex")).toBe("C");
    expect(monogram("ACP")).toBe("A");
    expect(monogram("x")).toBe("X");
  });

  it("returns ? for empty, whitespace-only, and emoji-only names", () => {
    expect(monogram("")).toBe("?");
    expect(monogram("   \t\n ")).toBe("?");
    expect(monogram("🚀")).toBe("?");
    expect(monogram("🇸🇮 👩‍💻")).toBe("?");
    expect(monogram("... !?")).toBe("?");
    expect(monogram(undefined as unknown as string)).toBe("?");
  });

  it("skips emoji between words", () => {
    expect(monogram("🚀 Rocket")).toBe("R");
    expect(monogram("👩‍💻 dev agent")).toBe("DA");
  });

  it("never splits a surrogate pair", () => {
    for (const name of ["🚀", "𝒜gent", "👩‍💻 x", "a🚀b", "🇸🇮"]) {
      expect(monogram(name)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(monogram(name)).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(monogram("𝒜gent")).toBe("𝒜");
  });

  it("uppercases accented and decomposed letters correctly", () => {
    expect(monogram("élan vital")).toBe("ÉV");
    expect(monogram("élan")).toBe("É");
  });

  it("keeps letters whole when uppercasing would make two", () => {
    expect(monogram("ßeta")).toBe("ß");
  });

  it("drops marks that cannot compose with their letter", () => {
    expect(monogram("1️⃣ agent")).toBe("1A");
  });

  it("handles scripts without case, and digits", () => {
    expect(monogram("克劳德")).toBe("克");
    expect(monogram("1password agent")).toBe("1A");
  });
});

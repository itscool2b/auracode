import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHOSEN_DIRECTION_ID, DIRECTIONS, DIRECTIONS_BY_ID, getDirection } from "../directions";
import { isWallpaperId } from "../shared/wallpapers";
import { hashForcesReducedMotion } from "./reducedMotion";
import { CORE_STATES, isLabState, LAB_STATES, STATE_INFO } from "./states";
import { DEFAULT_THEME, isLabTheme, LAB_THEMES } from "./theme";

const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));

describe("the direction registry", () => {
  it("lists orbit (the chosen one) first, then aurora, noir and halo, each with a name, a tagline and an App", () => {
    expect(DIRECTIONS.map((direction) => direction.id)).toEqual([
      "orbit",
      "aurora",
      "noir",
      "halo",
    ]);
    expect(CHOSEN_DIRECTION_ID).toBe("orbit");
    expect(DIRECTIONS[0]?.id).toBe(CHOSEN_DIRECTION_ID);
    for (const direction of DIRECTIONS) {
      expect(direction.id).toMatch(/^[a-z]+$/);
      expect(direction.name.trim()).not.toBe("");
      expect(direction.tagline.trim()).not.toBe("");
      expect(direction.App).toBeDefined();
      expect(getDirection(direction.id)).toBe(direction);
    }
    expect(DIRECTIONS_BY_ID.size).toBe(DIRECTIONS.length);
    expect(getDirection("constructor")).toBeNull();
  });

  it("fills in each direction's states, themes and wallpaper, defaulting to the core five, dark, dusk", () => {
    for (const direction of DIRECTIONS) {
      // Every direction renders the core states; the rest are opt-in, and only real states count.
      for (const state of CORE_STATES) expect(direction.states).toContain(state);
      for (const state of direction.states) expect(isLabState(state)).toBe(true);
      expect(new Set(direction.states).size).toBe(direction.states.length);
      // URLs default to dark, so every direction draws it.
      expect(direction.themes).toContain(DEFAULT_THEME);
      for (const theme of direction.themes) expect(isLabTheme(theme)).toBe(true);
      expect(isWallpaperId(direction.wallpaper)).toBe(true);
    }
    for (const id of ["aurora", "noir", "halo"]) {
      expect(getDirection(id)).toMatchObject({
        states: CORE_STATES,
        themes: ["dark"],
        wallpaper: "dusk",
      });
    }
    expect(getDirection("orbit")).toMatchObject({
      states: LAB_STATES,
      themes: ["dark", "light"],
      wallpaper: "satin",
    });
  });

  it("gives every direction a folder with an App, a name card and a README", () => {
    for (const direction of DIRECTIONS) {
      const folder = join(APP_DIR, "src", "directions", direction.id);
      for (const file of ["App.tsx", "meta.ts", "README.md"]) {
        expect(statSync(join(folder, file)).isFile()).toBe(true);
      }
    }
  });
});

describe("states", () => {
  it("knows its seven states, the core five first, and describes each", () => {
    expect(LAB_STATES).toEqual([
      "streaming",
      "settled",
      "empty",
      "permission",
      "picker",
      "changes",
      "onboarding",
    ]);
    expect(CORE_STATES).toEqual(LAB_STATES.slice(0, 5));
    for (const state of LAB_STATES) {
      expect(isLabState(state)).toBe(true);
      expect(STATE_INFO[state].label).not.toBe("");
      expect(STATE_INFO[state].description).not.toBe("");
    }
    expect(isLabState("toString")).toBe(false);
  });

  it("knows its themes, dark first and by default", () => {
    expect(LAB_THEMES).toEqual(["dark", "light"]);
    expect(DEFAULT_THEME).toBe("dark");
    expect(isLabTheme("light")).toBe(true);
    expect(isLabTheme("system")).toBe(false);
    expect(isLabTheme("constructor")).toBe(false);
  });
});

describe("reduced motion from the URL", () => {
  it("reads motion=reduce from a hash", () => {
    expect(hashForcesReducedMotion("#/aurora/settled?motion=reduce")).toBe(true);
    expect(hashForcesReducedMotion("#/aurora/settled?t=3&motion=Reduce")).toBe(true);
    expect(hashForcesReducedMotion("#/aurora/settled?motion=full")).toBe(false);
    expect(hashForcesReducedMotion("#/aurora/settled")).toBe(false);
  });
});

/** Text files of the lab, outside generated and installed folders. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "shots", ".vite"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(tsx?|mjs|css|md|json|html)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("writing rules", () => {
  it("uses no em dashes anywhere in the lab, directions included", () => {
    // Built from its code point, so this file does not contain the character it looks for.
    const emDash = String.fromCodePoint(0x2014);
    const offenders = sources(APP_DIR).filter((path) =>
      readFileSync(path, "utf8").includes(emDash),
    );
    expect(offenders.map((path) => relative(APP_DIR, path))).toEqual([]);
  });
});

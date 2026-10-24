import { describe, expect, it } from "vitest";
import tauriConf from "../src-tauri/tauri.conf.json";
import { WEBKIT_TARGET } from "../vite.config";

/**
 * The Safari version each macOS release ships with. WKWebView is the system WebKit, so the oldest
 * macOS the bundle installs on decides the oldest WebKit the page can meet (users may update
 * Safari past it, but nothing guarantees they did).
 */
const SAFARI_SHIPPED_WITH: Readonly<Record<string, string>> = {
  "13.3": "16.4",
  "13.4": "16.5",
  "13.5": "16.6",
  "14.0": "17.0",
  "14.1": "17.1",
  "14.2": "17.2",
  "14.3": "17.3",
  "14.4": "17.4",
  "14.5": "17.5",
  "14.6": "17.6",
  "15.0": "18.0",
  "15.1": "18.1",
  "15.2": "18.2",
  "15.3": "18.3",
  "15.4": "18.4",
  "15.5": "18.5",
  "15.6": "18.6",
  "26.0": "26.0",
};

/** [major, minor] from "16.4", "safari16.4" or "safari17". */
function version(text: string): [number, number] {
  const match = /^(?:safari)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`not a version: ${text}`);
  return [Number(match[1]), Number(match[2] ?? 0)];
}

describe("build targets", () => {
  const minimumMacos = tauriConf.bundle.macOS.minimumSystemVersion;

  it("build for exactly the WebKit the oldest supported macOS ships", () => {
    const shipped = SAFARI_SHIPPED_WITH[minimumMacos];
    // A missing entry means the floor moved: add it to the table above (from Apple's release notes).
    expect(shipped, `Safari shipped with macOS ${minimumMacos}`).toBeDefined();
    // A newer target than the shipped WebKit drops CSS the oldest systems need (the window renders
    // unstyled); an older one would downlevel for systems the bundle refuses to install on.
    expect(version(WEBKIT_TARGET)).toEqual(version(shipped ?? ""));
  });

  it("never target a WebKit older than Tailwind 4 supports", () => {
    // Tailwind 4 emits cascade layers, @property and color-mix(): Safari 16.4 is its floor.
    const [major, minor] = version(WEBKIT_TARGET);
    expect(major > 16 || (major === 16 && minor >= 4)).toBe(true);
  });
});

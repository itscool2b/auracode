import { Check, Sparkles } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sceneFor, workspaceFor } from "../fixture/scenes";
import {
  composerLabel,
  findChat,
  formatCost,
  formatCount,
  formatDuration,
  formatElapsed,
  LAB_STATES as KIT_STATES,
  WINDOW_WIDTH as KIT_WINDOW_WIDTH,
  modelLabel,
  parseInline,
  parseMarkdown,
  stageHref,
  stripAnsi,
  usePlayhead,
} from "../kit";
import { LAB_STATES } from "../lab/states";
import { reduceTranscript } from "../model/transcript";
import { staticPlayer } from "../model/usePlayer";
import { PlainTranscript } from "./PlainTranscript";
import { WindowChrome } from "./WindowChrome";
import { isWallpaperId, WALLPAPER_IDS, wallpaperLayout } from "./wallpapers";
import {
  TRAFFIC_LIGHTS,
  viewportInWindow,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  windowMargin,
  windowScale,
} from "./window";

describe("window geometry", () => {
  it("matches the desktop app's window", () => {
    expect([WINDOW_WIDTH, WINDOW_HEIGHT]).toEqual([1440, 900]);
    expect(TRAFFIC_LIGHTS.left).toBe(18);
    expect(TRAFFIC_LIGHTS.right).toBe(70);
  });

  it("fits the window inside the viewport with a margin, never above its real size", () => {
    expect(windowMargin(1440, 900, false)).toBe(36);
    expect(windowScale(1440, 900)).toBeCloseTo((900 - 72) / 900, 5);
    expect(windowScale(3000, 2000)).toBe(1);
    expect(windowScale(480, 300, true)).toBeCloseTo((300 - 16) / 900, 5);
    expect(windowScale(0, 900)).toBe(1);
    expect(windowScale(Number.NaN, 900)).toBe(1);
    expect(windowScale(10, 10)).toBe(0.05);
  });

  it("maps the viewport into window coordinates, so the glass lines up with the wallpaper", () => {
    for (const [width, height, compact] of [
      [1440, 900, false],
      [2560, 1440, false],
      [480, 300, true],
      [1000, 1200, false],
    ] as const) {
      const scale = windowScale(width, height, compact);
      const rect = viewportInWindow(width, height, scale);
      // The window's left and top edges, in viewport px.
      const x0 = (width - WINDOW_WIDTH * scale) / 2;
      const y0 = (height - WINDOW_HEIGHT * scale) / 2;
      expect(rect.left * scale + x0).toBeCloseTo(0, 6);
      expect(rect.top * scale + y0).toBeCloseTo(0, 6);
      expect(rect.width * scale).toBeCloseTo(width, 6);
      expect(rect.height * scale).toBeCloseTo(height, 6);
      // The window sits inside the viewport it is fitted to.
      expect(rect.left).toBeLessThanOrEqual(0);
      expect(rect.left + rect.width).toBeGreaterThanOrEqual(WINDOW_WIDTH);
    }
    expect(viewportInWindow(0, 0, Number.NaN)).toEqual({
      left: 0,
      top: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
  });
});

describe("wallpapers", () => {
  it("draws the same picture for the same id, and a different one per id", () => {
    for (const id of WALLPAPER_IDS) {
      expect(wallpaperLayout(id)).toEqual(wallpaperLayout(id));
      const layout = wallpaperLayout(id);
      for (const ribbon of [...layout.fields, ...layout.strands]) {
        expect(ribbon.path).toMatch(/^M-?\d/);
        expect(ribbon.path.endsWith("Z")).toBe(true);
        expect(ribbon.path).not.toContain("NaN");
      }
    }
    expect(wallpaperLayout("dusk")).not.toEqual(wallpaperLayout("dawn"));
    expect(isWallpaperId("dawn")).toBe(true);
    expect(isWallpaperId("plaid")).toBe(false);
  });
});

describe("server-rendered markup", () => {
  it("renders the window around its content", () => {
    const html = renderToString(
      <WindowChrome wallpaper="graphite">
        <p>inside</p>
      </WindowChrome>,
    );
    expect(html).toContain("data-lab-window");
    // The glass is a second, grainless copy of the wallpaper inside the window.
    expect(html.match(/data-wallpaper="graphite"/g)).toHaveLength(2);
    expect(html.match(/lab-wallpaper-grain/g)).toHaveLength(1);
    expect(html).toContain("<p>inside</p>");
    expect(html.match(/lab-traffic-light"/g)).toHaveLength(3);
  });

  it("renders the plain transcript for every state, from the props alone", () => {
    for (const state of LAB_STATES) {
      const scene = sceneFor(state);
      const model = reduceTranscript(scene.recording?.events ?? []);
      const workspace = workspaceFor(scene, model);
      // React separates adjacent text nodes with empty comments; drop them to read the text.
      const html = renderToString(
        <PlainTranscript
          name="Test"
          accent="#ffffff"
          state={state}
          model={model}
          workspace={workspace}
          player={staticPlayer(scene.recording?.duration ?? 0)}
        />,
      ).replaceAll("<!-- -->", "");
      expect(html).toContain("Test placeholder");
      expect(html).toContain(`data-state="${state}"`);
      if (state === "settled") {
        expect(html).toContain("All 19 pacing tests pass.");
        expect(html).toContain("2 files changed");
        expect(html).toContain("$0.21");
      }
      if (state === "permission") expect(html).toContain("Run cargo test -p aura-drivers?");
      if (state === "picker") expect(html).toContain("Extra high");
      if (state === "empty") expect(html).toContain("What should we build in auracode?");
    }
  });
});

describe("what directions get", () => {
  it("renders lucide-react icons with React 19", () => {
    const html = renderToString(
      <>
        <Check size={16} />
        <Sparkles size={16} strokeWidth={1.5} />
      </>,
    );
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("exports the kit's helpers", () => {
    const helpers = [
      usePlayhead,
      parseMarkdown,
      parseInline,
      stripAnsi,
      formatElapsed,
      formatDuration,
      formatCount,
      formatCost,
      composerLabel,
      modelLabel,
      findChat,
      stageHref,
    ];
    for (const helper of helpers) expect(typeof helper).toBe("function");
    expect(KIT_WINDOW_WIDTH).toBe(WINDOW_WIDTH);
    expect(KIT_STATES).toBe(LAB_STATES);
  });
});

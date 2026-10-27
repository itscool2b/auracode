import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFrameClock } from "../frameClock";
import { orbitClock, createFrameClock as orbitCreateFrameClock } from "../orbit/clock";
import { CopyButton as OrbitCopyButton } from "../orbit/index";
import { CopyButton } from "./CopyButton";
import { DitherField } from "./DitherField";
import * as graphite from "./index";
import { Keycap } from "./Keycap";
import { Logo, Wordmark } from "./Logo";
import { LOGO_PATH, LOGO_SMALL_PATH } from "./logoPaths";
import { PixelLoader } from "./PixelLoader";
import { StatusDot } from "./StatusDot";

/*
 * The website prerenders with React Router, so every component must render on a server: no window,
 * no document, no canvas context. These run in Node, where touching any of them throws.
 */
describe("server rendering", () => {
  it("renders a decorative DitherField as an empty canvas, hidden from assistive tech", () => {
    const html = renderToString(createElement(DitherField, { className: "hero-field" }));
    expect(html).toMatch(/^<div class="g-dither hero-field" aria-hidden="true">/);
    expect(html).toContain('<canvas class="g-dither-canvas">');
    expect(html).not.toContain("<img");
  });

  it("ships the fallback image for no-JS visitors and the first paint", () => {
    const html = renderToString(
      createElement(DitherField, { fallbackSrc: "/hero-dither.png", style: { height: 480 } }),
    );
    expect(html).toContain('<img class="g-dither-fallback" src="/hero-dither.png" alt=""');
    expect(html).toContain("height:480px");
  });

  it("keeps revealed content readable: no aria-hidden, wrapped above the canvas in source", () => {
    const html = renderToString(
      createElement(
        DitherField,
        { target: { kind: "image", src: "/shot.png" }, progress: 0.4, reveal: true },
        createElement("img", { src: "/shot.png", alt: "The auracode window" }),
      ),
    );
    expect(html).not.toContain("aria-hidden");
    expect(html).toContain('data-reveals=""');
    expect(html).toContain(
      '<div class="g-dither-content"><img src="/shot.png" alt="The auracode window"/>',
    );
  });

  it("names a meaningful field as an image", () => {
    const html = renderToString(createElement(DitherField, { label: "auracode" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="auracode"');
  });

  it("renders the logo in currentColor, decorative unless named, small variant at 24px and below", () => {
    const html = renderToString(createElement(Logo, { size: 16 }));
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('fill-rule="evenodd"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="16"');
    expect(html).toContain(LOGO_SMALL_PATH);
    const named = renderToString(createElement(Logo, { size: 32, label: "auracode" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="auracode"');
    expect(named).toContain(LOGO_PATH);
  });

  it("sets the wordmark as real text after a logo a quarter taller than the type", () => {
    const html = renderToString(createElement(Wordmark, { size: 16 }));
    expect(html).toContain('<span class="g-wordmark-text">auracode</span>');
    expect(html).toContain("font-size:16px");
    expect(html).toContain('width="20"');
    expect(renderToString(createElement(Wordmark, { size: 32 }))).toContain('width="40"');
    expect(renderToString(createElement(Wordmark, { mark: false }))).not.toContain("<svg");
  });

  it("renders status dots as squares and live ones as the loader", () => {
    const dot = renderToString(createElement(StatusDot, { tone: "volt" }));
    expect(dot).toContain('data-tone="volt"');
    expect(dot).toContain('aria-hidden="true"');
    const labelled = renderToString(createElement(StatusDot, { tone: "red", label: "Failed" }));
    expect(labelled).toContain('role="img"');
    const live = renderToString(createElement(StatusDot, { tone: "green", live: true }));
    expect(live).toContain("g-loader g-status-live");
    expect(live.match(/<rect/g)).toHaveLength(6);
    expect(live).toContain("g-px-green");
  });

  it("renders a loader's six cells at their static pattern", () => {
    const html = renderToString(createElement(PixelLoader, { size: 16, label: "Working" }));
    expect(html.match(/<rect/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Working"');
  });

  it("renders keys as kbd", () => {
    const html = renderToString(createElement(Keycap, { label: "Command" }, "⌘"));
    expect(html).toBe('<kbd class="g-keycap" aria-label="Command">⌘</kbd>');
  });

  it("styles the copy button with Graphite classes and keeps the Orbit hooks", () => {
    const html = renderToString(createElement(CopyButton, { text: "pnpm test", caption: "Copy" }));
    expect(html).toContain('class="g-copy o-copy"');
    expect(html).toContain('aria-label="Copy"');
    expect(html).toContain('data-state="ready"');
    expect(OrbitCopyButton).toBe(CopyButton);
  });
});

describe("module surface", () => {
  it("shares one frame clock between Orbit and Graphite", () => {
    expect(orbitCreateFrameClock).toBe(createFrameClock);
    expect(graphite.frameClock).toBe(orbitClock);
  });

  it("exports the components and helpers the website and desktop build on", () => {
    for (const name of [
      "AgentMark",
      "CopyButton",
      "DitherField",
      "Keycap",
      "PixelLoader",
      "Logo",
      "StatusDot",
      "Wordmark",
      "agentCode",
      "renderDitherFrame",
      "logoSvg",
      "LOGO_PATH",
      "GRAPHITE_COLORS",
      "contrastRatio",
    ]) {
      expect(graphite, name).toHaveProperty(name);
    }
  });
});

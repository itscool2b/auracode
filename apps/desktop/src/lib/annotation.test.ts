import { describe, expect, it } from "vitest";
import type { BrowserPick, PickedElement } from "../bindings";
import { looksLikeAddress } from "../components/browser/AddressBar";
import { notePosition } from "../components/browser/AnnotationComposer";
import { type Annotation, annotationText, cropBox, elementLabel, marks } from "./annotation";

const button: PickedElement = {
  tag: "button",
  id: null,
  classes: ["cta", "primary", "large"],
  selector: "section.hero > button.cta",
  text: "Start free",
  rect: { x: 40, y: 200, width: 100, height: 40 },
  styles: { color: "rgb(255, 255, 255)", "background-color": "", display: "inline-flex" },
  component: { name: "HeroButton", stack: ["App", "Pricing", "HeroButton"], framework: "React" },
  html: '<button class="cta">Start free</button>',
};

const pick = (change: Partial<BrowserPick> = {}): BrowserPick => ({
  mode: "element",
  url: "http://localhost:3104/pricing",
  title: "Acme · Pricing",
  add: false,
  viewport: { width: 1000, height: 700, dpr: 1 },
  area: null,
  elements: [button],
  screenshot: null,
  ...change,
});

describe("what Annotate sends", () => {
  it("names an element in a line, its text cut at sixty characters", () => {
    expect(elementLabel(button)).toBe('<button.cta.primary> "Start free"');
    expect(elementLabel({ tag: "div", id: "root", rect: button.rect })).toBe("<div#root>");
    const long = elementLabel({ ...button, classes: [], text: "x".repeat(80) });
    expect(long).toBe(`<button> "${"x".repeat(60)}…"`);
  });

  it("puts the note first, then where it points, as an agent can find it", () => {
    const text = annotationText("  Make it blue  ", { pick: pick(), elements: [button] }, true);
    expect(text.split("\n")).toEqual([
      "Make it blue",
      "",
      'Annotated in the browser on "Acme · Pricing" (http://localhost:3104/pricing):',
      '- <button.cta.primary> "Start free"',
      "   Selector: section.hero > button.cta",
      "   Component: HeroButton (React: App › Pricing › HeroButton)",
      "   100×40 at (40, 200) in a 1000×700 view",
      "   Styles: color rgb(255, 255, 255); display inline-flex",
      '   HTML: <button class="cta">Start free</button>',
      "The attached image shows it outlined on the page.",
    ]);
  });

  it("numbers several elements, marks an area, and leaves out an image it cannot send", () => {
    const area = { x: 10, y: 20, width: 300, height: 120 };
    const second = { ...button, text: "Sign in", rect: { x: 600, y: 500, width: 80, height: 30 } };
    const text = annotationText(
      "",
      { pick: pick({ mode: "area", area, title: "" }), elements: [button, second] },
      false,
    );
    expect(text).toMatch(/^Annotated in the browser on http:\/\/localhost:3104\/pricing:/);
    expect(text).toContain('1. <button.cta.primary> "Start free"');
    expect(text).toContain('2. <button.cta.primary> "Sign in"');
    expect(text).toContain("The area marked: 300×120 at (10, 20) in a 1000×700 view.");
    expect(text).not.toContain("attached image");
    expect(marks({ pick: pick({ mode: "area", area }), elements: [button] })).toEqual([area]);
  });
});

describe("the image's crop", () => {
  const annotation = (
    rect: PickedElement["rect"],
    viewport = { width: 1000, height: 700 },
  ): Annotation => ({
    pick: pick({ viewport: { ...viewport, dpr: 1 } }),
    elements: [{ ...button, rect }],
  });

  it("keeps room around the mark, at least the least size, centred on it", () => {
    const box = cropBox(annotation({ x: 400, y: 300, width: 100, height: 40 }));
    expect(box.width).toBe(560);
    expect(box.height).toBe(360);
    // The mark sits in the middle of the crop.
    expect((box.x ?? 0) + (box.width ?? 0) / 2).toBeCloseTo(450);
    expect((box.y ?? 0) + (box.height ?? 0) / 2).toBeCloseTo(320);
  });

  it("stays inside the view at its edges and in a small view", () => {
    const corner = cropBox(annotation({ x: 5, y: 5, width: 50, height: 20 }));
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    expect(corner.width).toBe(560);
    const small = cropBox(
      annotation({ x: 10, y: 10, width: 50, height: 20 }, { width: 300, height: 200 }),
    );
    expect(small).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    const whole = cropBox({ pick: pick(), elements: [] });
    expect(whole).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });
});

describe("where the note sits", () => {
  const page = { width: 800, height: 600 };
  const note = { width: 380, height: 160 };

  it("goes below the pick, or above it when there is no room, inside the page", () => {
    expect(notePosition({ x: 40, y: 100, width: 100, height: 40 }, page, note)).toEqual({
      left: 40,
      top: 150,
    });
    expect(notePosition({ x: 40, y: 500, width: 100, height: 40 }, page, note)).toEqual({
      left: 40,
      top: 330,
    });
    // Near the right edge it moves left to stay on the page.
    expect(notePosition({ x: 700, y: 100, width: 80, height: 20 }, page, note).left).toBe(412);
    // A pick as tall as the page: the note stays inside it.
    const tall = notePosition({ x: 0, y: 0, width: 800, height: 600 }, page, note);
    expect(tall.top).toBeGreaterThanOrEqual(8);
    expect(tall.top + note.height).toBeLessThanOrEqual(600 - 8);
  });
});

describe("addresses and searches", () => {
  it("reads typed words as the browser will", () => {
    for (const address of [
      "https://example.com",
      "example.com",
      "docs.example.co.uk/guide",
      "localhost:5173",
      "localhost",
      "127.0.0.1:8080/app",
      "[::1]:3000",
      "devbox:3000",
      "C:/site/index.html",
      "about:blank",
      "my-app.test",
      "intranet.internal:8443",
    ])
      expect(looksLikeAddress(address), address).toBe(true);
    for (const search of ["how to center a div", "react", "file.txt", "v1.2", "", "  "])
      expect(looksLikeAddress(search), search).toBe(false);
  });
});

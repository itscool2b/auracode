import { DitherField, frameClock, PIXEL_MARK_GRID, Wordmark } from "@auracode/ui/graphite";
import { useEffect, useState } from "react";

/**
 * The field condenses in Graphite's standard greys. Once the pixel "a" has formed it lights to the
 * bright palette, so the mark reads as ink beside the word rather than as a grey patch.
 */
const FORMING = "standard";
const FORMED = "bright";
/** One dither cell in CSS px; the engine snaps it to whole device pixels. */
const CELL = 4;
/** The engine's ceiling on cells per frame; past it the cell grows. Mirrored to place the word. */
const MAX_CELLS = 240_000;
/** The dissolve runs from 200ms to 1400ms; the word rises at 1400ms (visual-language.md 6.17). */
const DISSOLVE_FROM = 200;
const DISSOLVE_TO = 1400;
const WORD_AT = 1400;

/**
 * `--g-ease`, cubic-bezier(0.4, 0, 0.2, 1), solved for y at a given x. The spec's ease-out front
 * loads the dissolve so hard that the field is gone within a quarter second of starting; the
 * standard curve keeps the noise on screen long enough to see the mark come out of it.
 */
function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = [0.4, 0, 0.2, 1];
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  let low = 0;
  let high = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    const value = sampleX(t);
    if (Math.abs(value - x) < 1e-5) break;
    if (value < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

/** Where the engine will put the grid target, so the word can sit under it on whole pixels. */
function layout(width: number, height: number) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let deviceCell = Math.max(1, Math.round(CELL * dpr));
  let cols = Math.ceil((width * dpr) / deviceCell);
  let rows = Math.ceil((height * dpr) / deviceCell);
  while (cols * rows > MAX_CELLS) {
    deviceCell += 1;
    cols = Math.ceil((width * dpr) / deviceCell);
    rows = Math.ceil((height * dpr) / deviceCell);
  }
  const cell = deviceCell / dpr;
  // About a quarter of the shorter side, in whole field cells per glyph pixel.
  const scale = Math.min(
    14,
    Math.max(4, Math.round((Math.min(width, height) * 0.26) / (6 * cell))),
  );
  const left = Math.floor((cols - 6 * scale) / 2) * cell;
  const top = Math.floor((rows - 6 * scale) / 2) * cell;
  return { scale, centre: left + 3 * scale * cell, below: top + 6 * scale * cell };
}

export type IntroMode = "pending" | "live" | "still";

/**
 * The first-launch signature: a full-window dither field that condenses into the pixel "a", then
 * "auracode" rises under it. `live` plays the dissolve; `still` shows the formed mark (later launches
 * and reduced motion); `pending` is the black window before setup has said which. The caller fades
 * it out by setting `leaving`, then unmounts it.
 */
export function SetupIntro({
  mode,
  leaving,
}: {
  readonly mode: IntroMode;
  readonly leaving: false | "slow" | "fast";
}) {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [progress, setProgress] = useState(mode === "live" ? 0 : 1);
  const [word, setWord] = useState(mode === "still");
  useEffect(() => {
    const measure = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (mode !== "live") {
      setProgress(1);
      setWord(mode === "still");
      return;
    }
    setProgress(0);
    setWord(false);
    let start: number | null = null;
    let stop = () => {};
    stop = frameClock().subscribe((now) => {
      start ??= now;
      const elapsed = now - start;
      setProgress(ease((elapsed - DISSOLVE_FROM) / (DISSOLVE_TO - DISSOLVE_FROM)));
      if (elapsed >= WORD_AT) {
        setWord(true);
        stop();
      }
    });
    return () => stop();
  }, [mode]);
  const place = layout(size.width, size.height);
  return (
    <div
      className="setup-intro"
      data-cinematic={leaving ? undefined : ""}
      data-leaving={leaving || undefined}
      aria-hidden="true"
    >
      {mode === "pending" ? null : (
        <DitherField
          className="setup-intro-field"
          cell={CELL}
          density={0.45}
          palette={progress >= 1 ? FORMED : FORMING}
          order="radial"
          target={{ kind: "grid", rows: PIXEL_MARK_GRID, scale: place.scale, texture: 0.1 }}
          progress={progress}
          still={mode === "still"}
        />
      )}
      {word ? (
        <span
          className="setup-intro-word"
          style={{ top: `${place.below + 28}px`, left: `${place.centre}px` }}
        >
          <span className={mode === "live" ? "g-rise" : undefined}>
            <Wordmark size={32} mark={false} />
          </span>
        </span>
      ) : null}
    </div>
  );
}

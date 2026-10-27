import { DitherField, type DitherTarget } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AGENT_NAMES } from "../agents";
import {
  type FieldClearing,
  FRAME_FIELD,
  STAGE_CLEARING,
  STAGE_FALLBACK,
  STAGE_FIELD,
} from "../fields";
import { useReducedMotion, useScrollValue } from "../motion";
import { RotatingAgent } from "./RotatingAgent";

/** How far beyond the copy the field stays thinned, across and down: the copy sits in the core. */
const REACH_X = 2.3;
const REACH_Y = 2.1;

/**
 * The opening stage: the live dither field fills it edge to edge and thins to black behind the
 * headline, lead and buttons; the product frame sits in the lower half inside Vercel's hairline
 * guides, and its own field dissolves into the real screenshot as it scrolls up the page.
 */
export function Stage() {
  const stage = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const reduced = useReducedMotion();
  const [clearing, setClearing] = useState<FieldClearing>(STAGE_CLEARING);
  const [source, setSource] = useState<string | null>(null);
  // 0 while the frame's top is at 80% of the viewport, 1 once it reaches 25%.
  const progress = useScrollValue(
    frame,
    (rect, viewport) => (viewport * 0.8 - rect.top) / (viewport * 0.55),
  );

  useEffect(() => {
    const field = stage.current;
    const block = copy.current;
    if (!field || !block || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = field.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const part of block.querySelectorAll("[data-clear]")) {
        const r = part.getBoundingClientRect();
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      if (!Number.isFinite(left)) return;
      const round = (value: number) => Math.round(value * 1000) / 1000;
      const next = {
        x: round(((left + right) / 2 - box.left) / box.width),
        y: round(((top + bottom) / 2 - box.top) / box.height),
        rx: round((((right - left) / 2) * REACH_X) / box.width),
        ry: round((((bottom - top) / 2) * REACH_Y) / box.height),
      };
      setClearing((previous) =>
        previous.x === next.x &&
        previous.y === next.y &&
        previous.rx === next.rx &&
        previous.ry === next.ry
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    observer.observe(block);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const img = image.current;
    if (!img) return;
    const ready = () => {
      if (img.currentSrc) setSource(img.currentSrc);
    };
    if (img.complete && img.naturalWidth > 0) ready();
    else img.addEventListener("load", ready, { once: true });
    return () => img.removeEventListener("load", ready);
  }, []);

  const target: DitherTarget | undefined = source
    ? { kind: "image", src: source, fit: "cover" }
    : undefined;

  return (
    <div className="stage" ref={stage}>
      <DitherField
        className="stage-field site-field"
        cell={STAGE_FIELD.cell}
        density={STAGE_FIELD.density}
        accent={STAGE_FIELD.accent}
        palette={STAGE_FIELD.palette}
        seed={STAGE_FIELD.seed}
        clearing={clearing}
      />
      <noscript>
        <img className="field-fallback" src={`/${STAGE_FALLBACK.file}`} alt="" />
      </noscript>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy" ref={copy}>
          <h1 id="hero-title" className="hero-title" aria-label="One window for your coding agents">
            <span className="hero-line" data-clear="" aria-hidden="true">
              <span className="hero-word" style={{ "--i": 0 } as CSSProperties}>
                One
              </span>{" "}
              <span className="hero-word" style={{ "--i": 1 } as CSSProperties}>
                window
              </span>{" "}
              <span className="hero-word" style={{ "--i": 2 } as CSSProperties}>
                for
              </span>
            </span>
            <span className="hero-line" data-clear="" aria-hidden="true">
              <span className="hero-word" style={{ "--i": 3 } as CSSProperties}>
                <RotatingAgent names={AGENT_NAMES} />.
              </span>
            </span>
          </h1>
          <p className="hero-lead" data-clear="">
            <strong>The coding agents you already use, together in one chat.</strong> auracode runs
            each one through its own harness, on your machine. Free, local, and no account needed.
          </p>
          <div className="hero-actions" data-clear="">
            <a className="g-button g-button-primary g-button-44 hero-cta" href="/download">
              Download
            </a>
            <a className="g-button g-button-outline g-button-44 hero-cta" href="/signin">
              Invited sign-in
            </a>
          </div>
        </div>
      </section>
      <div className="showcase">
        <figure className="product-frame" ref={frame}>
          <span className="g-crosshair g-crosshair-tl" aria-hidden="true" />
          <span className="g-crosshair g-crosshair-tr" aria-hidden="true" />
          <span className="g-crosshair g-crosshair-bl" aria-hidden="true" />
          <span className="g-crosshair g-crosshair-br" aria-hidden="true" />
          <DitherField
            className="product-field site-field"
            cell={FRAME_FIELD.cell}
            density={FRAME_FIELD.density}
            accent={FRAME_FIELD.accent}
            palette={FRAME_FIELD.palette}
            seed={FRAME_FIELD.seed}
            target={target}
            progress={reduced ? 1 : progress}
            reveal
            order="down"
          >
            <picture>
              <source
                type="image/webp"
                srcSet="/images/desktop-dark-480.webp 480w, /images/desktop-dark-960.webp 960w, /images/desktop-dark-1440.webp 1440w"
                sizes="(max-width: 620px) calc(100vw - 60px), (max-width: 900px) calc(100vw - 76px), (max-width: 1232px) calc(100vw - 60px), 1172px"
              />
              <img
                ref={image}
                src="/images/desktop-dark.png"
                width="1440"
                height="900"
                alt="The auracode desktop: project navigation, an agent response with code, and a composer with agent and autonomy controls."
                fetchPriority="high"
              />
            </picture>
          </DitherField>
        </figure>
      </div>
    </div>
  );
}

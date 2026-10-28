import { DitherField, type DitherTarget } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AGENT_NAMES } from "../agents";
import { HERO_CREATURES, HERO_CREATURES_COMPACT } from "../creatures";
import {
  type FieldClearing,
  FRAME_FIELD,
  STAGE_CLEARING,
  STAGE_FALLBACK,
  STAGE_FIELD,
} from "../fields";
import { useMedia, useReducedMotion, useScrollValue } from "../motion";
import { RotatingAgent } from "./RotatingAgent";

/**
 * How far beyond the copy the field stays thinned, across and down: the copy sits in the core. On a
 * phone the copy fills the width, so the clearing reaches past both edges.
 */
const REACH_X = 1.55;
const REACH_Y = 1.7;
const REACH_X_COMPACT = 3;
const REACH_Y_COMPACT = 1.8;
/** The second clearing keeps the product frame's top edge calm: its width and height in px. */
const SEAM_RX = 0.625;
const SEAM_RY = 210;
const SEAM_DROP = 40;
/** A third clearing fades the field out toward the stage's bottom edge, so it never ends in a cut. */
const FOOT_RY = 220;

/**
 * x.ai's hero: a centred two-line headline, one lead and one action, the product right under it.
 * The live dither field fills the stage edge to edge, gathers toward the sides and thins to black
 * behind the headline, lead and button and along the product frame's top edge.
 * Seals and turtles swim through it. The frame's own field dissolves into the real screenshot,
 * already under way when the page opens, as the frame scrolls up; on a phone, where a dithered
 * screenshot is too small to read, the screenshot shows at once.
 */
export function Stage() {
  const stage = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const frame = useRef<HTMLElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const reduced = useReducedMotion();
  const compact = useMedia("(max-width: 767px)");
  const [clearing, setClearing] = useState<readonly FieldClearing[]>(STAGE_CLEARING);
  const [source, setSource] = useState<string | null>(null);
  // Already past half when the frame's top first shows below the copy, so the screenshot's top has
  // formed when the page opens; done once the frame's top reaches 55% of the viewport.
  const progress = useScrollValue(
    frame,
    (rect, viewport) => (viewport * 1.15 - rect.top) / (viewport * 0.6),
  );

  useEffect(() => {
    const field = stage.current;
    const block = copy.current;
    const section = hero.current;
    if (!field || !block || !section || typeof ResizeObserver === "undefined") return;
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
      const seam = section.getBoundingClientRect().bottom - box.top;
      const next: readonly FieldClearing[] = [
        {
          x: round(((left + right) / 2 - box.left) / box.width),
          y: round(((top + bottom) / 2 - box.top) / box.height),
          rx: round((((right - left) / 2) * (compact ? REACH_X_COMPACT : REACH_X)) / box.width),
          ry: round((((bottom - top) / 2) * (compact ? REACH_Y_COMPACT : REACH_Y)) / box.height),
        },
        {
          x: 0.5,
          y: round((seam + SEAM_DROP) / box.height),
          rx: SEAM_RX,
          ry: round(SEAM_RY / box.height),
        },
        { x: 0.5, y: 1, rx: 1, ry: round(FOOT_RY / box.height) },
      ];
      setClearing((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    observer.observe(block);
    observer.observe(section);
    measure();
    return () => observer.disconnect();
  }, [compact]);

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
        edges={compact ? 0 : STAGE_FIELD.edges}
        ceiling={STAGE_FIELD.ceiling}
        accent={STAGE_FIELD.accent}
        palette={STAGE_FIELD.palette}
        seed={STAGE_FIELD.seed}
        clearing={clearing}
        sprites={compact ? HERO_CREATURES_COMPACT : HERO_CREATURES}
        interactive
      />
      <noscript>
        <img className="field-fallback" src={`/${STAGE_FALLBACK.file}`} alt="" />
      </noscript>
      <section className="hero" aria-labelledby="hero-title" ref={hero}>
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
            The coding agents you already use, together in one chat on your machine. Free, with
            nothing to sign up for.
          </p>
          <div className="hero-actions" data-clear="">
            <a className="g-button g-button-primary g-button-44" href="/download">
              Download
            </a>
          </div>
        </div>
      </section>
      <div className="showcase">
        <figure className="product-frame" ref={frame}>
          <DitherField
            className="product-field site-field"
            cell={FRAME_FIELD.cell}
            density={FRAME_FIELD.density}
            accent={FRAME_FIELD.accent}
            palette={FRAME_FIELD.palette}
            seed={FRAME_FIELD.seed}
            target={target}
            progress={reduced || compact ? 1 : progress}
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

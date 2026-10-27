import { DitherField, type DitherTarget } from "@auracode/ui/graphite";
import { type CSSProperties, useRef } from "react";
import { NUMERAL_CLEARING, NUMERAL_FIELD, NUMERAL_SEEDS } from "../fields";
import { useMedia, useReducedMotion, useScrollValue } from "../motion";

const NUMBERS = [
  { value: "9", title: "agents supported", note: "plus any agent that speaks ACP" },
  { value: "2", title: "platforms", note: "Windows and macOS" },
  { value: "0", title: "accounts needed", note: "to use the app" },
] as const;

const PIXEL_FONT = '"Geist Pixel", ui-monospace, monospace';
/** Geist Pixel's figures stand about 0.73em tall; the box keeps just that, so nothing sits empty above. */
const FIGURE_HEIGHT = 0.76;

/**
 * The AI in Design report's giant numerals, set in Geist Pixel and condensing out of their own
 * dither fields as the section scrolls in, left to right; one rule splits them from their captions.
 * Without JavaScript they are plain text; under reduced motion they are the formed still frame.
 */
export function Numerals() {
  const row = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const compact = useMedia("(max-width: 767px)");
  // 0 as the numerals' top enters the bottom of the viewport, 1 once it reaches 45%.
  const progress = useScrollValue(
    row,
    (rect, viewport) => (viewport - rect.top) / (viewport * 0.55),
    { step: 0.004 },
  );
  const size = compact ? 128 : 340;
  return (
    <section className="section numerals" aria-labelledby="numerals-title">
      <div className="wrap numerals-grid">
        <h2 id="numerals-title" className="title" data-reveal="">
          Local by default. <span>Nothing to sign up for.</span>
        </h2>
        <ul
          className="numerals-list"
          ref={row}
          style={
            {
              "--figure": `${size}px`,
              "--figure-h": `${Math.round(size * FIGURE_HEIGHT)}px`,
            } as CSSProperties
          }
        >
          {NUMBERS.map((item, i) => {
            const own = Math.min(1, Math.max(0, progress * 1.35 - i * 0.16));
            const formed = reduced || own >= 1;
            const target: DitherTarget = {
              kind: "text",
              text: item.value,
              fontFamily: PIXEL_FONT,
              fontWeight: 400,
              fontSize: size,
              tracking: 0,
              align: "start",
              anchor: "bottom",
              texture: 0.12,
            };
            return (
              <li className="numeral" key={item.value}>
                <span className="numeral-figure" aria-hidden="true">
                  <span className="numeral-text">{item.value}</span>
                  <DitherField
                    className="numeral-field site-field"
                    cell={NUMERAL_FIELD.cell}
                    density={NUMERAL_FIELD.density}
                    accent={NUMERAL_FIELD.accent}
                    palette={NUMERAL_FIELD.palette}
                    seed={NUMERAL_SEEDS[i] ?? NUMERAL_FIELD.seed}
                    clearing={NUMERAL_CLEARING}
                    target={target}
                    progress={formed ? 1 : own}
                    still={formed}
                  />
                </span>
                <span className="sr-only">{item.value} </span>
                <span className="numeral-title">{item.title}</span>{" "}
                <span className="numeral-note">{item.note}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

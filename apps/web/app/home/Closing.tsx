import { DitherField } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { CLOSING_CREATURES, CLOSING_CREATURES_COMPACT } from "../creatures";
import {
  CLOSING_CLEARING,
  CLOSING_CLEARING_COMPACT,
  CLOSING_FALLBACK,
  CLOSING_FIELD,
} from "../fields";
import { useMedia } from "../motion";

/**
 * The closing statement over a dark dither band that thins to black behind the words, with a turtle
 * and a seal crossing it. On a phone the words fill the width, so two seals keep above and below them.
 */
export function Closing() {
  const compact = useMedia("(max-width: 767px)");
  return (
    <section className="closing" aria-labelledby="closing-title">
      <DitherField
        className="closing-field site-field"
        cell={CLOSING_FIELD.cell}
        density={CLOSING_FIELD.density}
        ceiling={CLOSING_FIELD.ceiling}
        accent={CLOSING_FIELD.accent}
        palette={CLOSING_FIELD.palette}
        seed={CLOSING_FIELD.seed}
        clearing={compact ? CLOSING_CLEARING_COMPACT : CLOSING_CLEARING}
        sprites={compact ? CLOSING_CREATURES_COMPACT : CLOSING_CREATURES}
      />
      <noscript>
        <img className="field-fallback" src={`/${CLOSING_FALLBACK.file}`} alt="" />
      </noscript>
      <div className="closing-inner">
        <h2 id="closing-title" className="closing-title" data-reveal="">
          Your agents. <span>Your machine.</span>
        </h2>
        <div className="closing-actions" data-reveal="" style={{ "--i": 1 } as CSSProperties}>
          <a className="g-button g-button-primary g-button-44" href="/download">
            Download
          </a>
        </div>
      </div>
    </section>
  );
}

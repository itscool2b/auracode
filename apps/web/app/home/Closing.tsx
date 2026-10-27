import { DitherField } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { CLOSING_CLEARING, CLOSING_FALLBACK, CLOSING_FIELD } from "../fields";

/** The closing statement over a quiet dither band that thins to black behind the words. */
export function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <DitherField
        className="closing-field site-field"
        cell={CLOSING_FIELD.cell}
        density={CLOSING_FIELD.density}
        accent={CLOSING_FIELD.accent}
        palette={CLOSING_FIELD.palette}
        clearing={CLOSING_CLEARING}
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

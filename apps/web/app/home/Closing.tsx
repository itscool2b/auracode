import { DitherField } from "@auracode/ui/graphite";
import { CLOSING_CREATURES, CLOSING_CREATURES_COMPACT } from "../creatures";
import {
  CLOSING_CLEARING,
  CLOSING_CLEARING_COMPACT,
  CLOSING_FALLBACK,
  CLOSING_FIELD,
} from "../fields";
import { useMedia } from "../motion";

/**
 * Aside's closing panel ("Crafted for both human and agent. Start using today."): one rounded panel
 * in the content column, a centred two-line statement and one primary action. Behind it a dark
 * dither field that thins to black behind the words, with a turtle and a seal crossing it; on a
 * phone, where the words fill the width, two seals keep above and below them.
 */
export function Closing() {
  const compact = useMedia("(max-width: 767px)");
  return (
    <section className="section closing" aria-labelledby="closing-title">
      <div className="wrap">
        <div className="closing-panel" data-reveal="">
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
            transparent
          />
          <noscript>
            <img className="field-fallback" src={`/${CLOSING_FALLBACK.file}`} alt="" />
          </noscript>
          <h2 id="closing-title" className="title closing-title">
            Your agents. <span>Your machine.</span>
          </h2>
          <a className="g-button g-button-primary g-button-44" href="/download">
            Download
          </a>
        </div>
      </div>
    </section>
  );
}

import type { CSSProperties } from "react";
import { AGENTS } from "./Sprite";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * A digit on a reel: when the block scrolls into view the reel spins down to the figure, with a
 * blur that settles as it lands. Without scripts or motion the figure simply stands.
 */
function Reel({ value, from }: { value: number; from: number }) {
  return (
    <span
      className="reel"
      aria-hidden="true"
      style={{ "--to": value, "--from": from } as CSSProperties}
    >
      <span className="reel-strip">
        {DIGITS.map((digit) => (
          <span key={digit} className="reel-digit">
            {digit}
          </span>
        ))}
      </span>
    </span>
  );
}

const FIGURES = [
  { value: 1, from: 8, text: "window for every agent you run, side by side in one chat." },
  {
    value: AGENTS.length,
    from: 0,
    text: "agents with their own marks and harnesses, plus any agent that speaks ACP.",
  },
  { value: 0, from: 9, text: "accounts to create. Local work never asks you to sign in." },
] as const;

/** Three true figures, set huge, each rolling into place on its own reel. */
export function Numbers() {
  return (
    <section className="section numbers" aria-labelledby="numbers-title">
      <h2 id="numbers-title" className="sr-only">
        auracode in three numbers
      </h2>
      <div className="wrap numbers-grid" data-reveal="">
        {FIGURES.map((figure, i) => (
          <div key={figure.text} className="figure" style={{ "--n": i } as CSSProperties}>
            <p className="figure-number">
              <span className="sr-only">{figure.value}</span>
              <Reel value={figure.value} from={figure.from} />
            </p>
            <p className="figure-text">{figure.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

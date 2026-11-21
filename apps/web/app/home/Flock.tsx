import type { CSSProperties } from "react";
import { Wing } from "./Wing";

/**
 * Nine of o7's own wings in nine colours, each at its own height and tilt: `hue` is the wing's
 * colour, `rise` how far above the row's line it flies (in its own widths), `tilt` its bank in
 * degrees and `size` its width against the row's. The colours are o7's, chosen to read on the
 * dark page and on the light one; no agent's or assistant's colour is among them, so no wing
 * stands for a vendor.
 */
const WINGS: readonly { hue: string; rise: number; tilt: number; size: number }[] = [
  { hue: "#b9824a", rise: 0.1, tilt: -7, size: 1 },
  { hue: "#e5484d", rise: -0.16, tilt: 5, size: 0.94 },
  { hue: "#f76b15", rise: 0.14, tilt: -3, size: 1.04 },
  { hue: "#f5a524", rise: -0.12, tilt: 8, size: 0.92 },
  { hue: "#46a758", rise: 0.16, tilt: -5, size: 1 },
  { hue: "#12a594", rise: -0.1, tilt: 4, size: 0.96 },
  { hue: "#3e7bfa", rise: 0.12, tilt: -8, size: 1.04 },
  { hue: "#8e5cf0", rise: -0.14, tilt: 6, size: 0.94 },
  { hue: "#e93d82", rise: 0.06, tilt: -4, size: 1 },
];

/**
 * A flock of o7's wing in colour across the column, where dot.com sets its row of coloured bots
 * (owner, 21 November 2026: "dot.com ... has a bunch of colored little grok bots, add that but
 * for the o7 website"). They are the page's one run of colour that is not an agent's mark. Each
 * lands after the one before it when the row scrolls in, then hovers at its own pace, blinks in
 * its own time, looks toward the pointer and hops when the pointer is over it. Decorative, so
 * hidden from assistive technology; whole and still without scripts or where motion is not
 * welcome (styles/home.css).
 */
export function Flock() {
  return (
    <div className="wrap flock" aria-hidden="true" data-reveal="" data-zone="">
      {WINGS.map((wing, i) => (
        <span
          key={wing.hue}
          className="flock-wing"
          style={
            {
              "--flock": wing.hue,
              "--rise": wing.rise,
              "--tilt": `${wing.tilt}deg`,
              "--size": wing.size,
              "--i": i,
            } as CSSProperties
          }
        >
          <span className="flock-float">
            <Wing look />
          </span>
        </span>
      ))}
    </div>
  );
}

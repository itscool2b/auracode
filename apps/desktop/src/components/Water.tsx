import { Shallows, type SwimmerSpec, Swimmers } from "@auracode/ui/graphite";
import "./water.css";

/*
 * The app's Shallows (docs/design/visual-language.md, 6.13 and 6.17): lit water seen from below
 * with seals and turtles passing as dark silhouettes. The specs live at module level so the swim
 * never restarts when a screen re-renders.
 */

/**
 * How far down setup's light falls: past the window's foot, so the upper half where the swimmers
 * and the intro's mark sit stays light enough to see them against. The intro and setup share it,
 * so the hand-off from one to the other changes nothing in the water.
 */
export const SETUP_WATER_DEPTH = "140%";

/**
 * Setup's window: a large turtle at the left, a seal at the right heading the other way, and one
 * small far turtle near the surface for depth. The card sits over the middle, so they cross behind
 * it and never under the words.
 */
export const SETUP_SWIMMERS: readonly SwimmerSpec[] = [
  {
    kind: "turtle",
    x: 0.17,
    y: 0.3,
    size: "clamp(168px, 19vw, 296px)",
    tilt: -10,
    speed: 7,
    phase: 3,
  },
  {
    kind: "seal",
    x: 0.79,
    y: 0.25,
    size: "clamp(220px, 25vw, 384px)",
    heading: "left",
    speed: 10,
    phase: 9,
  },
  { kind: "turtle", x: 0.68, y: 0.11, size: 88, depth: 0.6, tilt: -24, speed: 4, phase: 21 },
];

/**
 * New chat's pane: one seal high at the left and one far turtle at the right, slower than setup's,
 * because the person works here. They never yield to the pointer: the hand lives on the composer,
 * and nothing behind it should move because of it.
 */
export const PANE_SWIMMERS: readonly SwimmerSpec[] = [
  { kind: "seal", x: 0.2, y: 0.17, size: "clamp(152px, 16vw, 232px)", speed: 6, phase: 5 },
  {
    kind: "turtle",
    x: 0.83,
    y: 0.15,
    size: "clamp(88px, 8vw, 116px)",
    heading: "left",
    depth: 0.45,
    tilt: -18,
    speed: 4,
    phase: 14,
  },
];

/** The stress view's worst case: every swimmer the app draws, in one pane at once. */
export const STRESS_SWIMMERS: readonly SwimmerSpec[] = [...SETUP_SWIMMERS, ...PANE_SWIMMERS];

/**
 * A layer of lit water with its swimmers, filling its positioned parent behind the content. It is
 * decoration only: hidden from assistive technology and never under the pointer.
 */
export function Water({
  swimmers,
  className,
  depth,
  giveWay = false,
  still = false,
}: {
  readonly swimmers: readonly SwimmerSpec[];
  readonly className?: string;
  /** How far down the light falls (Shallows' `depth`); default the layer's height. */
  readonly depth?: string;
  readonly giveWay?: boolean;
  readonly still?: boolean;
}) {
  return (
    <Shallows
      className={className ? `app-water ${className}` : "app-water"}
      depth={depth}
      aria-hidden="true"
    >
      <Swimmers swimmers={swimmers} giveWay={giveWay} still={still} />
    </Shallows>
  );
}

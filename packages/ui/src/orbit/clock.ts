/*
 * The frame clock moved to ../frameClock.ts so Graphite's marks and swimmers share the same loop.
 * Orbit keeps its names: `orbitClock()` is the same singleton as `frameClock()`.
 */
export {
  createFrameClock,
  type FrameClock,
  type FrameHost,
  frameClock as orbitClock,
} from "../frameClock";

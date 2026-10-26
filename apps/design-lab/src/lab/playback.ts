import type { StageRoute } from "./route";

/**
 * How a state plays, from its scene and the URL:
 * - `?t=` freezes the playhead there (until play is pressed, or with `play=1`, plays from there);
 * - a looping scene (streaming) plays from the start and loops, unless `play=0`;
 * - the other scenes hold their finished recording, unless `play=1` plays and loops them.
 */
export function playbackFor(
  route: Pick<StageRoute, "t" | "play">,
  playback: "loop" | "end",
  duration: number,
): { startAt: number; autoplay: boolean; loop: boolean } {
  const loop = playback === "loop" || route.play === true;
  if (route.t !== null) {
    return { startAt: Math.min(duration, route.t * 1000), autoplay: route.play === true, loop };
  }
  if (playback === "loop") return { startAt: 0, autoplay: route.play !== false, loop };
  if (route.play === true) return { startAt: 0, autoplay: true, loop };
  return { startAt: duration, autoplay: false, loop };
}

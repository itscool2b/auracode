import type { OrbState } from "../orb/states";
import { type ActivitySegment, type MarkTimeline, RIPPLE_MS } from "./geometry";

export interface OrbitActivity {
  readonly state: OrbState;
  readonly since: number;
  readonly timeline: MarkTimeline;
}

/** Retains phase across state changes without keeping an unbounded chat history in each mark. */
export function transitionActivity(
  previous: OrbitActivity | null,
  state: OrbState,
  time: number,
): OrbitActivity {
  if (previous?.state === state) return previous;
  const since = Math.max(previous?.since ?? time, time);
  let segments: ActivitySegment[] = (previous?.timeline.segments ?? []).map((segment) =>
    segment.to === null ? { ...segment, to: since } : segment,
  );
  segments.push({ from: since, to: null, state });
  if (segments.length > 64) {
    const old = segments.slice(0, -32);
    const retained = segments.slice(-32);
    const boundary = retained[0]?.from ?? since;
    const travelled = old.reduce(
      (total, segment) =>
        total +
        Math.max(0, (segment.to ?? boundary) - segment.from) *
          (segment.state === "streaming" ? 1 : segment.state === "thinking" ? 2 / 3 : 0),
      0,
    );
    segments = [{ from: boundary - travelled, to: boundary, state: "streaming" }, ...retained];
  }
  const ripples =
    previous?.timeline.ripples.filter((ripple) => since - ripple.at < RIPPLE_MS) ?? [];
  if (state === "tool" || previous?.state === "tool" || state === "waiting") {
    ripples.push({ at: since, tone: state === "waiting" ? "signal" : "ink" });
  }
  return { state, since, timeline: { segments, ripples: ripples.slice(-8), streamedChars: 0 } };
}

/** Settled states stop scheduling frames. Only actual thinking/streaming moves continuously. */
export function motionDeadline(activity: OrbitActivity): number {
  switch (activity.state) {
    case "thinking":
    case "streaming":
      return Number.POSITIVE_INFINITY;
    case "done":
      return activity.since + 2150;
    case "waiting":
    case "tool":
      return activity.since + RIPPLE_MS;
    case "error":
      return activity.since + 400;
    default:
      return Math.max(
        activity.since,
        ...activity.timeline.ripples.map((ripple) => ripple.at + RIPPLE_MS),
      );
  }
}

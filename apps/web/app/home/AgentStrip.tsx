import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { AgentMark, createCadence, frameClock } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * A row of agent marks (visual language 5.4 and 5.5): each agent's own published logo, or its
 * two-letter code where its maker allows no logo use, in the app's 24px tile. Three motions, all
 * transform and opacity, all still under reduced motion:
 * - entrance: once the row is in view (and its panel shown), the marks rise 10px and fade in,
 *   24ms apart, done within 600ms;
 * - life: each mark drifts up and down by 1.5px on its own slow period, so no two ever move
 *   together, stepping about 20 times a second and only while the row is on screen in a visible
 *   tab (the swimmers' cadence);
 * - hover: the mark lifts 3px and a soft shadow with a lit top edge fades in under it, over 300ms.
 * A mark moves as a whole: never scaled, skewed, rotated or recoloured (third-party/brand-marks.md).
 */

/** Seconds per drift and the phase each starts at; no two periods share a common short cycle. */
const DRIFT: readonly (readonly [number, number])[] = [
  [6.1, 0],
  [7.3, 1.9],
  [5.6, 3.7],
  [6.8, 0.8],
  [7.9, 2.6],
  [5.9, 4.4],
  [6.5, 1.3],
  [7.6, 3.1],
  [5.3, 5],
];
const AMPLITUDE = 1.5;
/** About 20 steps a second: at 1.5px of travel a step moves well under a tenth of a pixel. */
const STEP_WAIT_MS = 40;

export interface AgentStripProps {
  /** Brand ids, in order. */
  readonly agents: readonly AgentBrandId[];
  /** False while the row's panel is hidden: the entrance replays when it shows again. */
  readonly active?: boolean;
  /** The list's accessible name; without one the row is decorative (the text names the agents). */
  readonly label?: string;
  /** The agent under the pointer, or null once it leaves. */
  readonly onPoint?: (agent: AgentBrandId | null) => void;
  readonly className?: string;
}

export function AgentStrip({ agents, active = true, label, onPoint, className }: AgentStripProps) {
  const list = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(list, { threshold: 0.4 });
  const [shown, setShown] = useState(false);
  // The drift's own clock: it advances only while the row moves, so resuming never jumps.
  const drift = useRef({ seconds: 0, last: -1 });

  // The entrance plays once per showing: latched when the row is first seen, reset when hidden.
  useEffect(() => {
    if (!active) setShown(false);
    else if (inView) setShown(true);
  }, [active, inView]);

  const live = shown && active && inView && visible && !reduced;

  useEffect(() => {
    const root = list.current;
    if (!root || !live) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>(".agent-strip-drift"));
    const clock = drift.current;
    clock.last = -1;
    const cadence = createCadence(
      {
        subscribe: (listener) => frameClock().subscribe(listener),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
      },
      (time) => {
        if (clock.last >= 0) clock.seconds += Math.min(0.1, (time - clock.last) / 1000);
        clock.last = time;
        const seconds = clock.seconds;
        // The drift grows in over its first two seconds, so the marks leave rest without a step.
        const ramp = Math.min(1, seconds / 2);
        const reach = AMPLITUDE * ramp * ramp * (3 - 2 * ramp);
        marks.forEach((mark, i) => {
          const [period, phase] = DRIFT[i % DRIFT.length] ?? [6, 0];
          const y = reach * Math.sin(((seconds + phase) / period) * Math.PI * 2);
          mark.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
        });
      },
      () => false,
      STEP_WAIT_MS,
    );
    cadence.start();
    // Paused, a mark keeps its place; it never snaps back.
    return () => cadence.stop();
  }, [live]);

  // Reduced motion: every mark at rest.
  useEffect(() => {
    if (!reduced) return;
    for (const mark of list.current?.querySelectorAll<HTMLElement>(".agent-strip-drift") ?? [])
      mark.style.transform = "";
  }, [reduced]);

  return (
    <ul
      ref={list}
      className={className ? `agent-strip ${className}` : "agent-strip"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-shown={shown ? "" : undefined}
      data-live={live ? "" : undefined}
      onPointerLeave={() => onPoint?.(null)}
    >
      {agents.map((id, i) => (
        <li
          key={id}
          style={{ "--i": i } as CSSProperties}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onPoint?.(id);
          }}
        >
          <span className="agent-strip-drift">
            <span className="agent-strip-lift">
              <AgentMark agent={id} size={24} label={AGENT_BRANDS[id].name} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

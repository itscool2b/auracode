import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../motion";
import { AGENTS, SpriteMark } from "./Sprite";

/** How fast each lane travels, in CSS pixels per second, whatever the screen or set width. */
const FRONT_SPEED = 34;
const BACK_SPEED = 22;

/** The back lane starts mid-list, so the same agent never runs above itself. */
const BACK: readonly AgentBrandId[] = [...AGENTS.slice(4), ...AGENTS.slice(0, 4)];

/**
 * One lane: a run of identical sets, twice as many as it takes to cover the lane. The lane slides
 * left by exactly half its length (one half's worth of sets), where the second half lines up with
 * where the first began, so the loop never shows a seam, a gap or a jump at any width. Its speed is
 * set in pixels per second, so a longer set takes longer rather than moving faster.
 */
function Lane({
  agents,
  speed,
  back = false,
  label,
}: {
  agents: readonly AgentBrandId[];
  speed: number;
  back?: boolean;
  label?: string;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const [loop, setLoop] = useState<{ sets: number; seconds: number } | null>(null);

  useEffect(() => {
    const node = lane.current?.parentElement;
    const set = first.current;
    if (!node || !set || reduced) {
      setLoop(null);
      return;
    }
    const measure = () => {
      const view = node.clientWidth;
      const width = set.getBoundingClientRect().width;
      if (!view || !width) return;
      // Each half covers the lane on its own, so the lane is always at least twice its view.
      const sets = Math.max(1, Math.ceil(view / width));
      const seconds = Number(((sets * width) / speed).toFixed(3));
      setLoop((current) =>
        current?.sets === sets && current.seconds === seconds ? current : { sets, seconds },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(set);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [reduced, speed]);

  const count = loop ? loop.sets * 2 : 1;
  return (
    <div
      ref={lane}
      className={back ? "marquee-lane marquee-lane-back" : "marquee-lane"}
      data-ready={loop ? "" : undefined}
      data-sets={count}
      aria-hidden={back ? true : undefined}
      style={loop ? ({ "--marquee-seconds": `${loop.seconds}s` } as CSSProperties) : undefined}
    >
      {Array.from({ length: count }, (_, i) => (
        <ul
          // biome-ignore lint/suspicious/noArrayIndexKey: the copies are identical; position is identity.
          key={i}
          ref={i === 0 ? first : undefined}
          className="marquee-set"
          aria-label={i === 0 && !back ? label : undefined}
          aria-hidden={i > 0 && !back ? true : undefined}
        >
          {agents.map((agent) => (
            <li key={agent} className="marquee-item">
              <SpriteMark agent={agent} size={back ? 20 : 24} />
              <span>{AGENT_BRANDS[agent].name}</span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/**
 * Every agent auracode runs, on two lanes under the hero: the front lane glides left, a quieter
 * lane a step behind it glides right, each a set measured and repeated until the loop is seamless
 * at any width. Every mark keeps its name beside it, at the website's tile sizes
 * (third-party/brand-marks.md). The lanes hold under the pointer, offscreen and in a hidden tab.
 * Without scripts or with reduced motion, the front list stands still and wraps, every agent in
 * view, and the back lane is gone.
 */
export function Marquee() {
  return (
    <div className="marquee-block">
      <div className="marquee">
        <Lane agents={AGENTS} speed={FRONT_SPEED} label="Agents auracode runs" />
        <Lane agents={BACK} speed={BACK_SPEED} back />
      </div>
      <p className="marquee-note">
        Claude Code, Codex, Cursor and six more, each through its own harness and sign-in. Plus any
        agent that speaks ACP.
      </p>
    </div>
  );
}

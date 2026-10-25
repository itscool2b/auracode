import { useEffect, useState } from "react";
import { DIRECTIONS } from "../directions";
import { type Player, usePlayhead } from "../model/usePlayer";
import { type StageRoute, stageHref } from "./route";
import { LAB_STATES, STATE_INFO } from "./states";

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** True when keys belong to what has focus (a text field, a button, a select). */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName)
  );
}

/**
 * The lab's controls, outside the window: direction, state, play, scrub, speed, reduced motion.
 * Hidden until the pointer nears the bottom edge (so screenshots never show it), pinned with
 * `?hud=1` or the H key. Keys: Space plays or pauses, arrows step 2 s (10 s with Shift).
 */
export function Hud({
  route,
  player,
  pinned: pinnedByUrl,
}: {
  readonly route: StageRoute;
  readonly player: Player;
  readonly pinned: boolean;
}) {
  const time = usePlayhead(player, 100);
  const [near, setNear] = useState(false);
  const [pinned, setPinned] = useState(pinnedByUrl);

  useEffect(() => setPinned(pinnedByUrl), [pinnedByUrl]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      setNear(event.clientY > window.innerHeight - 140);
    };
    const onLeave = (): void => setNear(false);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
      const step = event.shiftKey ? 10_000 : 2_000;
      if (event.key === " ") {
        event.preventDefault();
        player.toggle();
      } else if (event.key === "ArrowLeft") {
        player.seek(player.getTime() - step);
      } else if (event.key === "ArrowRight") {
        player.seek(player.getTime() + step);
      } else if (event.key === "h" || event.key === "H") {
        setPinned((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const link = (changes: Partial<StageRoute>): string => stageHref({ ...route, ...changes });

  return (
    <div className="lab-hud" data-visible={pinned || near ? "" : undefined}>
      <a className="lab-hud-link" href="#/">
        Gallery
      </a>
      <select
        className="lab-hud-select"
        aria-label="Direction"
        value={route.direction}
        onChange={(event) => {
          window.location.hash = link({ direction: event.target.value });
        }}
      >
        {DIRECTIONS.map((direction) => (
          <option key={direction.id} value={direction.id}>
            {direction.name}
          </option>
        ))}
      </select>
      <nav className="lab-hud-states" aria-label="State">
        {LAB_STATES.map((state) => (
          <a
            key={state}
            href={link({ state, t: null, play: null })}
            className="lab-hud-state"
            aria-current={state === route.state ? "page" : undefined}
            title={STATE_INFO[state].description}
          >
            {STATE_INFO[state].label}
          </a>
        ))}
      </nav>
      <button
        type="button"
        className="lab-hud-button"
        onClick={() => player.toggle()}
        disabled={player.duration === 0}
      >
        {player.playing ? "Pause" : "Play"}
      </button>
      <input
        className="lab-hud-range"
        type="range"
        aria-label="Playhead"
        min={0}
        max={player.duration}
        step={100}
        value={Math.min(time, player.duration)}
        disabled={player.duration === 0}
        onChange={(event) => player.seek(Number(event.target.value))}
      />
      <span className="lab-hud-time">
        {clock(time)} / {clock(player.duration)}
      </span>
      <select
        className="lab-hud-select"
        aria-label="Speed"
        value={String(route.speed)}
        onChange={(event) => {
          window.location.hash = link({ speed: Number(event.target.value) });
        }}
      >
        {(SPEEDS as readonly number[]).includes(route.speed) ? null : (
          <option value={String(route.speed)}>{route.speed}x</option>
        )}
        {SPEEDS.map((speed) => (
          <option key={speed} value={String(speed)}>
            {speed}x
          </option>
        ))}
      </select>
      <a className="lab-hud-link" href={link({ reducedMotion: !route.reducedMotion })}>
        {route.reducedMotion ? "Full motion" : "Reduce motion"}
      </a>
    </div>
  );
}

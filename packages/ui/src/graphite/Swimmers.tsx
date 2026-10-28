import { type CSSProperties, useEffect, useRef } from "react";
import { frameClock } from "../frameClock";
import { usePrefersReducedMotion } from "../motion";
import { Creature, creatureHeight } from "./Creature";
import { createCadence } from "./cadence";
import { CREATURE_SMALL_MAX } from "./creaturePaths";
import { ease, giveWay, type SwimmerSpec, swimPose } from "./swim";

export type { SwimmerSpec } from "./swim";

export interface SwimmersProps {
  /** The creatures, each anchored by fractions of the layer (see SwimmerSpec). */
  readonly swimmers: readonly SwimmerSpec[];
  readonly className?: string;
  /** Hold every creature where it is. Reduced motion always does. */
  readonly still?: boolean;
  /**
   * Creatures ease a little out of the pointer's way (fine pointers with hover only): a smooth
   * field, never a snap, read from the layer's parent. Default true.
   */
  readonly giveWay?: boolean;
}

/** How long a creature takes to give way to the pointer and to settle back, in seconds. */
const GIVE_TAU = 0.9;
/** The longest step the clock takes, so a hitch or a resumed tab never makes anyone jump. */
const MAX_STEP = 1 / 20;
/** Under this many pixels from where it swims, a creature that gave way has settled back. */
const SETTLED_PX = 0.05;

/**
 * Seals and turtles swimming through a Shallows panel (visual language 4.16): absolutely placed
 * in its parent, under its content, never under the pointer. Each creature moves by transform
 * only, from the shared frame clock, so motion stays on the compositor: no layout, no repaint.
 *
 * The server renders every creature at its anchor, and the first live frame is the same frame, so
 * nothing jumps on hydration. The clock runs only while the layer is on screen and the page is
 * visible, and at rest it steps about 30 times a second rather than at the display's rate
 * (cadence.ts): every display frame only while a creature gives way or settles back. Reduced
 * motion or `still` holds them where they are. Hover never changes layout and
 * never flickers: the layer takes no pointer events, and the optional give-way is eased.
 */
export function Swimmers({
  swimmers,
  className,
  still = false,
  giveWay: yields = true,
}: SwimmersProps) {
  const layer = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = usePrefersReducedMotion();
  // The motion restarts only when the creatures really change, not when a parent re-renders.
  const latest = useRef(swimmers);
  latest.current = swimmers;
  const key = JSON.stringify(swimmers);

  useEffect(() => {
    const root = layer.current;
    if (!root || still || reduced || !key) return;
    const swimmers = latest.current;
    const nodes = items.current.slice(0, swimmers.length);
    let width = root.clientWidth;
    let height = root.clientHeight;
    const extents = nodes.map((node) => node?.offsetWidth ?? 0);
    const offsets = swimmers.map(() => ({ x: 0, y: 0 }));
    let elapsed = 0;
    let last: number | null = null;
    let onScreen = typeof IntersectionObserver === "undefined";
    let pointer: { x: number; y: number } | null = null;

    const tick = (now: number) => {
      const step = last === null ? 0 : Math.min(MAX_STEP, Math.max(0, (now - last) / 1000));
      last = now;
      elapsed += step;
      // Read before writing, once a frame, so measuring never forces a layout.
      const box = pointer ? root.getBoundingClientRect() : null;
      swimmers.forEach((spec, i) => {
        const node = nodes[i];
        if (!node) return;
        const pose = swimPose(spec, elapsed, width, extents[i] ?? 0);
        const offset = offsets[i] as { x: number; y: number };
        let tx = 0;
        let ty = 0;
        if (pointer && box) {
          const away = giveWay(
            spec.x * width + pose.dx,
            spec.y * height + pose.dy,
            pointer.x - box.left,
            pointer.y - box.top,
          );
          tx = away.x;
          ty = away.y;
        }
        offset.x = ease(offset.x, tx, step, GIVE_TAU);
        offset.y = ease(offset.y, ty, step, GIVE_TAU);
        node.style.transform = `translate3d(${(pose.dx + offset.x).toFixed(2)}px, ${(pose.dy + offset.y).toFixed(2)}px, 0) rotate(${pose.rotate.toFixed(3)}deg)`;
      });
    };

    // Something eases while the pointer is in the panel or a creature has not settled back.
    const easing = () =>
      pointer !== null ||
      offsets.some((offset) => Math.abs(offset.x) > SETTLED_PX || Math.abs(offset.y) > SETTLED_PX);
    const cadence = createCadence(
      {
        subscribe: (listener) => frameClock().subscribe(listener),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
      },
      tick,
      easing,
    );
    let running = false;
    const reconcile = () => {
      const run = onScreen && document.visibilityState === "visible";
      if (run && !running) {
        running = true;
        last = null;
        cadence.start();
      } else if (!run && running) {
        running = false;
        cadence.stop();
      }
    };

    const sizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            width = root.clientWidth;
            height = root.clientHeight;
            nodes.forEach((node, i) => {
              extents[i] = node?.offsetWidth ?? 0;
            });
          });
    sizes?.observe(root);
    for (const node of nodes) if (node) sizes?.observe(node);

    const seen =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1];
              if (entry) onScreen = entry.isIntersecting;
              reconcile();
            },
            { rootMargin: "64px" },
          );
    seen?.observe(root);
    document.addEventListener("visibilitychange", reconcile);

    const host = root.parentElement;
    const fine =
      yields &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        pointer = { x: event.clientX, y: event.clientY };
        cadence.wake();
      }
    };
    const leave = () => {
      pointer = null;
    };
    if (fine && host) {
      host.addEventListener("pointermove", move, { passive: true });
      host.addEventListener("pointerleave", leave, { passive: true });
    }
    reconcile();

    return () => {
      cadence.stop();
      sizes?.disconnect();
      seen?.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      if (fine && host) {
        host.removeEventListener("pointermove", move);
        host.removeEventListener("pointerleave", leave);
      }
    };
  }, [key, still, reduced, yields]);

  return (
    <div
      className={className ? `g-swimmers ${className}` : "g-swimmers"}
      ref={layer}
      aria-hidden="true"
    >
      {swimmers.map((spec, i) => {
        const size = typeof spec.size === "number" ? `${spec.size}px` : spec.size;
        const style = {
          "--g-swimmer-x": `${spec.x * 100}%`,
          "--g-swimmer-y": `${spec.y * 100}%`,
          "--g-swimmer-w": size,
          "--g-swimmer-aspect": creatureHeight(spec.kind, 1).toFixed(4),
          "--g-swimmer-depth": String(Math.max(0, Math.min(1, spec.depth ?? 0))),
          // The first frame, pitch included, so the live clock takes over without a jump.
          transform: `rotate(${swimPose(spec, 0, 1, 0).rotate.toFixed(3)}deg)`,
        } as CSSProperties;
        return (
          <div
            // Creatures are positional and never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            key={i}
            className={spec.className ? `g-swimmer ${spec.className}` : "g-swimmer"}
            data-kind={spec.kind}
            data-far={(spec.depth ?? 0) > 0 ? "" : undefined}
            style={style}
            ref={(node) => {
              items.current[i] = node;
            }}
          >
            <Creature
              kind={spec.kind}
              facing={spec.heading ?? "right"}
              small={typeof spec.size === "number" && spec.size <= CREATURE_SMALL_MAX}
            />
          </div>
        );
      })}
    </div>
  );
}

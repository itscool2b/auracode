import { useEffect, useRef, useState } from "react";
import { getBrand } from "../brand";
import { usePrefersReducedMotion } from "../motion";
import { ORB_STATE_LABELS, type OrbState } from "../orb/states";
import { motionDeadline, type OrbitActivity, transitionActivity } from "./activity";
import { orbitClock } from "./clock";
import { markFrame, signatureOf } from "./geometry";
import { OrbitSvg } from "./OrbitSvg";

export interface OrbitMarkProps {
  readonly agent: string;
  readonly state?: OrbState;
  readonly size?: number;
  readonly label?: string;
  readonly surface?: string;
  readonly ghost?: boolean;
  readonly className?: string;
}

/** Live SVG identity. Idle, reduced-motion, hidden and offscreen marks own no animation frame. */
export function OrbitMark({
  agent,
  state = "idle",
  size = 24,
  label,
  surface,
  ghost = false,
  className,
}: OrbitMarkProps) {
  const brand = getBrand(agent);
  const safeSize = Number.isFinite(size) ? Math.max(1, Math.min(256, size)) : 24;
  const reduced = usePrefersReducedMotion();
  const element = useRef<SVGSVGElement>(null);
  const activity = useRef<OrbitActivity | null>(null);
  const [frame, setFrame] = useState(() =>
    markFrame(
      signatureOf(brand.id),
      transitionActivity(null, state, 0).timeline,
      0,
      safeSize,
      true,
    ),
  );

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const current = transitionActivity(activity.current, state, performance.now());
    activity.current = current;
    const signature = signatureOf(brand.id);
    const until = motionDeadline(current);
    let visible = typeof IntersectionObserver === "undefined";
    let unsubscribe: (() => void) | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
      if (expiry !== null) clearTimeout(expiry);
      expiry = null;
    };
    const draw = (time: number) => {
      setFrame(markFrame(signature, current.timeline, time, safeSize, reduced));
      if (time >= until) stop();
    };
    const reconcile = () => {
      stop();
      if (!visible || document.hidden) return;
      const now = performance.now();
      draw(now);
      if (ghost || now >= until) return;
      if (!reduced) {
        unsubscribe = orbitClock().subscribe(draw);
      } else if (state === "done") {
        // Reduced motion still expires the success check, without running an animation loop.
        expiry = setTimeout(() => draw(performance.now()), Math.max(0, until - now));
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            reconcile();
          });
    observer?.observe(node);
    document.addEventListener("visibilitychange", reconcile);
    // Paint the state even before the visibility observer's first notification.
    draw(performance.now());
    reconcile();
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [brand.id, safeSize, state, reduced, ghost]);

  return (
    <OrbitSvg
      elementRef={element}
      agent={brand.id}
      size={safeSize}
      surface={surface}
      ghost={ghost}
      className={className}
      reduced={reduced}
      frame={frame}
      label={label ?? `${brand.name}, ${ORB_STATE_LABELS[state]}`}
    />
  );
}

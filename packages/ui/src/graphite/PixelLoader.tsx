import { type RefObject, useEffect, useRef } from "react";
import { frameClock } from "../frameClock";
import { usePrefersReducedMotion } from "../motion";
import { LOADER_STEP_MS, loaderFrame, loaderRects } from "./pixels";

export type LoaderTone = "neutral" | "volt" | "green" | "red";
export type LoaderTempo = keyof typeof LOADER_STEP_MS;

/** Class of a loader cell at a brightness level; the head may take a tone. */
export function loaderCellClass(level: number, tone: LoaderTone = "neutral"): string {
  const head = level >= 3 && tone !== "neutral" ? ` g-px-${tone}` : "";
  return `g-px g-px-${Math.max(0, Math.min(3, Math.round(level)))}${head}`;
}

/**
 * Steps a loader's cells from the shared frame clock while it is on screen, the page is visible and
 * motion is allowed. Otherwise it owns no frame: it shows step 0, the static pattern. Steps come
 * from absolute time, so every loader at the same tempo lights the same cell at once.
 */
export function useLoaderSteps(
  svg: RefObject<SVGSVGElement | null>,
  active: boolean,
  tempo: LoaderTempo,
  tone: LoaderTone,
): void {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const node = svg.current;
    if (!node || !active) return;
    const cells = Array.from(node.querySelectorAll<SVGRectElement>("rect.g-px"));
    const paint = (levels: readonly number[]) => {
      cells.forEach((cell, i) => {
        cell.setAttribute("class", loaderCellClass(levels[i] ?? 0, tone));
      });
    };
    paint(loaderFrame(0));
    if (reduced) return;
    const stepMs = LOADER_STEP_MS[tempo];
    let visible = typeof IntersectionObserver === "undefined";
    let last = -1;
    let unsubscribe: (() => void) | null = null;
    const frame = (time: number) => {
      const step = Math.floor(time / stepMs);
      if (step === last) return;
      last = step;
      paint(loaderFrame(step));
    };
    const reconcile = () => {
      if (visible && !document.hidden) {
        unsubscribe ??= frameClock().subscribe(frame);
      } else {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            reconcile();
          });
    observer?.observe(node);
    document.addEventListener("visibilitychange", reconcile);
    reconcile();
    return () => {
      unsubscribe?.();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [svg, active, reduced, tempo, tone]);
}

export interface PixelLoaderProps {
  /** Square box in px; cells scale with it (2px cells up to 19px). Default 12. */
  readonly size?: number;
  /** Step rate: thinking 130ms, tool 110ms, streaming 90ms. Default "tool". */
  readonly tempo?: LoaderTempo;
  /** Colour of the lit head cell; the trail stays grey. Default "neutral" (white). */
  readonly tone?: LoaderTone;
  readonly className?: string;
  /** Accessible name; without one the loader is decorative. */
  readonly label?: string;
}

/** Six pixels in a 2x3 grid with a light walking round them: "working", without a spinner. */
export function PixelLoader({
  size = 12,
  tempo = "tool",
  tone = "neutral",
  className,
  label,
}: PixelLoaderProps) {
  const box = Number.isFinite(size) ? Math.max(8, Math.min(128, Math.round(size))) : 12;
  const ref = useRef<SVGSVGElement>(null);
  useLoaderSteps(ref, true, tempo, tone);
  return (
    <svg
      ref={ref}
      className={className ? `g-loader ${className}` : "g-loader"}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <LoaderCells size={box} tone={tone} />
    </svg>
  );
}

/** The six cells at step 0; useLoaderSteps animates them in place. */
export function LoaderCells({ size, tone }: { readonly size: number; readonly tone: LoaderTone }) {
  const levels = loaderFrame(0);
  return (
    <>
      {loaderRects(size).map((rect, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: six fixed cells that never reorder.
          key={i}
          className={loaderCellClass(levels[i] ?? 0, tone)}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
        />
      ))}
    </>
  );
}

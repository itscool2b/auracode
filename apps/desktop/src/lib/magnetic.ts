import { prefersReducedMotion } from "@auracode/ui";

/**
 * The app's magnetic controls (docs/design/visual-language.md, 6.9): the one white action on a
 * screen (a primary pill, the send disc) leans a few pixels toward the pointer while the pointer is
 * over it, and eases home when it leaves. Only its inline `translate` moves (motion.css eases it),
 * so layout never changes and the click target stays under the hand. At rest nothing is set, so a
 * control never holds a stacking context it does not need.
 *
 * Fine pointers only; nothing happens under reduced motion (the OS setting or the app's own) or
 * on a disabled control. One delegated listener serves the whole document.
 */
export const MAGNETIC_SELECTOR = ".g-button-primary, .chat-send:not([data-quiet])";

/** The furthest a control leans, in px, at its edge; its centre does not move. */
export const MAGNET_REACH = 3;

/** After easing home (motion.css, 300ms), the inline translate is dropped entirely. */
const RELEASE_MS = 360;

/** The lean for a pointer at (`x`, `y`) over a box: proportional to the offset, capped at reach. */
export function magnetOffset(
  box: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  x: number,
  y: number,
  reach = MAGNET_REACH,
): { readonly x: number; readonly y: number } {
  const halfWidth = Math.max(1, box.width / 2);
  const halfHeight = Math.max(1, box.height / 2);
  const dx = Math.max(-1, Math.min(1, (x - (box.left + halfWidth)) / halfWidth));
  const dy = Math.max(-1, Math.min(1, (y - (box.top + halfHeight)) / halfHeight));
  // Vertical lean is half the horizontal one: pills are wide and short.
  return { x: dx * reach, y: dy * reach * 0.5 };
}

function usable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    !element.matches(":disabled, [aria-disabled='true']") &&
    !prefersReducedMotion()
  );
}

/** Installs the delegated listener once; returns its removal. */
export function installMagnetic(root: Document = document): () => void {
  const view = root.defaultView;
  if (!view || typeof view.matchMedia !== "function") return () => {};
  const fine = view.matchMedia("(hover: hover) and (pointer: fine)");
  let current: HTMLElement | null = null;
  let lean = { x: 0, y: 0 };
  let frame = 0;
  let pointer = { x: 0, y: 0 };
  const release = () => {
    // Easing home goes to an explicit zero first, so the transition has somewhere to run to.
    if (current) current.style.translate = "0px 0px";
    const left = current;
    current = null;
    lean = { x: 0, y: 0 };
    if (left)
      view.setTimeout(() => {
        if (left !== current) left.style.removeProperty("translate");
      }, RELEASE_MS);
  };
  const apply = () => {
    frame = 0;
    if (!current || !usable(current)) {
      release();
      return;
    }
    // The box already holds the lean; measuring against its untranslated centre keeps it steady.
    const box = current.getBoundingClientRect();
    lean = magnetOffset(
      { left: box.left - lean.x, top: box.top - lean.y, width: box.width, height: box.height },
      pointer.x,
      pointer.y,
    );
    current.style.translate = `${lean.x.toFixed(2)}px ${lean.y.toFixed(2)}px`;
  };
  const move = (event: PointerEvent) => {
    if (!fine.matches || event.pointerType !== "mouse") return;
    const target = event.target instanceof Element ? event.target.closest(MAGNETIC_SELECTOR) : null;
    if (target !== current) release();
    if (!usable(target)) return;
    current = target;
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = view.requestAnimationFrame(apply);
  };
  const leave = () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    release();
  };
  const page = root.documentElement;
  root.addEventListener("pointermove", move, { passive: true });
  page.addEventListener("pointerleave", leave, { passive: true });
  view.addEventListener("blur", leave);
  return () => {
    leave();
    root.removeEventListener("pointermove", move);
    page.removeEventListener("pointerleave", leave);
    view.removeEventListener("blur", leave);
  };
}

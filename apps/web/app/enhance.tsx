import { useEffect } from "react";

/**
 * Inline boot script, the first thing in <head>. It marks the page as scripted so reveal start
 * states may apply, and removes the mark again if the app never hydrates, so nothing stays hidden.
 * The build hashes it into the static CSP (scripts/headers.mjs).
 */
export const BOOT_SCRIPT =
  '(function(){var d=document.documentElement;if(!("IntersectionObserver"in window))return;d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-ready"))d.classList.remove("js")},4000)})();';

const REDUCED = "(prefers-reduced-motion: reduce)";
const FINE = "(hover: hover) and (pointer: fine)";

/**
 * The page-wide motion layer, all of it off under reduced motion:
 * - reveals: blocks marked [data-reveal] arrive once as they enter, their children staggered;
 * - zones: [data-zone] sections hold their ambient loops while offscreen;
 * - magnetic: [data-magnetic] buttons lean a few pixels toward the pointer.
 * The pointer listener serves the magnetic pull only, and it does nothing on touch. Nothing here
 * paints light: the site has no glow (docs/design/visual-language.md).
 */
export function Enhancements() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ready", "");

    // Stagger each block's direct children by their position.
    for (const block of document.querySelectorAll<HTMLElement>("[data-reveal-stagger]")) {
      Array.from(block.children).forEach((child, i) => {
        (child as HTMLElement).style.setProperty("--i", String(i));
      });
    }

    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined" || matchMedia(REDUCED).matches) {
      for (const target of targets) target.setAttribute("data-revealed", "");
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute("data-revealed", "");
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
      );
      for (const target of targets) observer.observe(target);
    }

    // Zones with ambient motion (the hero's marquee and live window, the night band) hold it
    // while offscreen.
    let zones: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      zones = new IntersectionObserver((entries) => {
        for (const entry of entries)
          entry.target.toggleAttribute("data-off", !entry.isIntersecting);
      });
      for (const zone of document.querySelectorAll("[data-zone]")) zones.observe(zone);
    }

    // Pointer effects: only for a fine pointer with motion allowed.
    let frame = 0;
    let last: PointerEvent | null = null;
    let magnet: HTMLElement | null = null;
    const release = () => {
      if (!magnet) return;
      magnet.style.removeProperty("--mx");
      magnet.style.removeProperty("--my");
      magnet.removeAttribute("data-pulled");
      magnet = null;
    };
    const paint = () => {
      frame = 0;
      const event = last;
      if (!event || !(event.target instanceof Element)) return;
      const pull = event.target.closest<HTMLElement>("[data-magnetic]");
      if (pull !== magnet) release();
      if (pull) {
        const box = pull.getBoundingClientRect();
        const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
        const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
        pull.style.setProperty("--mx", `${(dx * 4).toFixed(2)}px`);
        pull.style.setProperty("--my", `${(dy * 3).toFixed(2)}px`);
        pull.setAttribute("data-pulled", "");
        magnet = pull;
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const pointer = matchMedia(FINE);
    const reduced = matchMedia(REDUCED);
    let listening = false;
    const sync = () => {
      const want = pointer.matches && !reduced.matches;
      if (want && !listening) document.addEventListener("pointermove", onMove, { passive: true });
      if (!want && listening) {
        document.removeEventListener("pointermove", onMove);
        release();
      }
      listening = want;
    };
    sync();
    pointer.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    document.addEventListener("pointerleave", release);

    return () => {
      observer?.disconnect();
      zones?.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", release);
      pointer.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

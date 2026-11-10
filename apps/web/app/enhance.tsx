import { useEffect } from "react";

/**
 * Inline boot script, the first thing in <head>. It marks the page as scripted so reveal start
 * states may apply, and removes the mark again if the app never hydrates, so nothing stays hidden.
 * The build hashes it into the static CSP (scripts/headers.mjs).
 */
export const BOOT_SCRIPT =
  '(function(){var d=document.documentElement;if(!("IntersectionObserver"in window))return;d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-ready"))d.classList.remove("js")},4000)})();';

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * The page-wide motion layer:
 * - reveals: blocks marked [data-reveal] arrive once as they enter (at once under reduced motion);
 * - zones: [data-zone] sections hold their ambient loops while offscreen, and the page holds them
 *   all while its tab is hidden ([data-hidden] on the root).
 * Nothing here follows the pointer or paints light: the site has no glow
 * (docs/design/visual-language.md).
 */
export function Enhancements() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ready", "");

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

    // Zones with ambient motion (the hero's live window, the capability views) hold it while
    // offscreen, and the whole page holds it while its tab is hidden.
    let zones: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      zones = new IntersectionObserver((entries) => {
        for (const entry of entries)
          entry.target.toggleAttribute("data-off", !entry.isIntersecting);
      });
      for (const zone of document.querySelectorAll("[data-zone]")) zones.observe(zone);
    }
    const onVisibility = () => root.toggleAttribute("data-hidden", document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer?.disconnect();
      zones?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}

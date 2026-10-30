import { useEffect } from "react";

/**
 * Inline boot script, the first thing in <head>. It marks the page as scripted so reveal start
 * states may apply, and removes the mark again if the app never hydrates, so nothing stays hidden.
 * The build hashes it into the static CSP (scripts/headers.mjs).
 */
export const BOOT_SCRIPT =
  '(function(){var d=document.documentElement;if(!("IntersectionObserver"in window))return;d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-ready"))d.classList.remove("js")},4000)})();';

/**
 * Marks the page hydrated and reveals blocks as they enter. Reduced motion renders them in place.
 */
export function Enhancements() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ready", "");
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver === "undefined") {
      for (const target of targets) target.setAttribute("data-revealed", "");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const target of targets) observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, []);
  return null;
}

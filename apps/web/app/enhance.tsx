import { useEffect } from "react";

/**
 * Inline boot script, the first thing in <head>. It marks the page as scripted so reveal start
 * states may apply, and removes the mark again if the app never hydrates, so nothing stays hidden.
 * The build hashes it into the static CSP (scripts/headers.mjs).
 */
export const BOOT_SCRIPT =
  '(function(){var d=document.documentElement;try{var p=localStorage.getItem("auracode-appearance");if(p==="light"||p==="dark")d.dataset.theme=p}catch(e){}if(!("IntersectionObserver"in window))return;d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-ready"))d.classList.remove("js")},4000)})();';

/**
 * Marks the page hydrated, reveals [data-reveal] blocks as they enter (a 16px rise and a fade,
 * staggered by --i) and makes the primary pills magnetic. Reduced motion renders blocks in place
 * through CSS.
 */
export function Enhancements() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ready", "");
    const stopMagnetic = () => {};
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver === "undefined") {
      for (const target of targets) target.setAttribute("data-revealed", "");
      return stopMagnetic;
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
      stopMagnetic();
    };
  }, []);
  return null;
}

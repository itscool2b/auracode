import { useEffect } from "react";

/**
 * Inline boot script, the first thing in <head>. It marks the page as scripted so reveal start
 * states may apply, and removes the mark again if the app never hydrates, so nothing stays hidden.
 * The build hashes it into the static CSP (scripts/headers.mjs).
 */
export const BOOT_SCRIPT =
  '(function(){var d=document.documentElement;if(!("IntersectionObserver"in window))return;d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-ready"))d.classList.remove("js")},4000)})();';

/** How far a magnetic pill leans toward the pointer, as a share of the pointer's offset. */
const PULL = 0.24;
/** The furthest it leans, in px, across and down. */
const REACH_X = 6;
const REACH_Y = 4;
/** Time constants in seconds: following the pointer, and settling back once it leaves. */
const FOLLOW = 0.12;
const SETTLE = 0.34;

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * Primary pills marked [data-magnetic] lean a few px toward the pointer, their label a little
 * further, and ease back when it leaves. Transform only, so layout never moves; each pill owns an
 * animation frame only while it is moving. Fine pointers only, and never under reduced motion.
 */
function magnetic(): () => void {
  const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!pointer.matches || reduced.matches) return () => {};
  const offs = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]")).map((pill) => {
    const label = pill.querySelector<HTMLElement>(".magnetic-label");
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const k = 1 - Math.exp(-dt / (tx === 0 && ty === 0 ? SETTLE : FOLLOW));
      x += (tx - x) * k;
      y += (ty - y) * k;
      const done = Math.abs(tx - x) < 0.02 && Math.abs(ty - y) < 0.02;
      if (done && tx === 0 && ty === 0) {
        x = 0;
        y = 0;
        pill.style.transform = "";
        if (label) label.style.transform = "";
      } else {
        pill.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        if (label)
          label.style.transform = `translate3d(${(x * 0.6).toFixed(2)}px, ${(y * 0.6).toFixed(2)}px, 0)`;
      }
      if (done) {
        frame = 0;
        last = 0;
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    const kick = () => {
      if (!frame) frame = window.requestAnimationFrame(step);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = pill.getBoundingClientRect();
      tx = clamp((event.clientX - (box.left - x + box.width / 2)) * PULL, REACH_X);
      ty = clamp((event.clientY - (box.top - y + box.height / 2)) * PULL, REACH_Y);
      kick();
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    pill.addEventListener("pointermove", move, { passive: true });
    pill.addEventListener("pointerleave", leave, { passive: true });
    return () => {
      pill.removeEventListener("pointermove", move);
      pill.removeEventListener("pointerleave", leave);
      if (frame) window.cancelAnimationFrame(frame);
      pill.style.transform = "";
      if (label) label.style.transform = "";
    };
  });
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Marks the page hydrated, reveals [data-reveal] blocks as they enter (a 16px rise and a fade,
 * staggered by --i) and makes the primary pills magnetic. Reduced motion renders blocks in place
 * through CSS.
 */
export function Enhancements() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ready", "");
    const stopMagnetic = magnetic();
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

import { useEffect, useRef } from "react";
import { AGENT_NAMES } from "../agents";
import { useReducedMotion } from "../motion";

/** Counts from 0 over 950ms once 10% of the row is in view (AI in Design's measured ease-out). */
const COUNT = 950;
const ease = (t: number) => 1 - (1 - t) ** 1.6;

const STATS: readonly { value: number; label: string }[] = [
  { value: AGENT_NAMES.length, label: "agents supported by name, plus any ACP agent" },
  { value: 2, label: "platforms, Windows and macOS" },
  { value: 0, label: "accounts needed to use the app" },
];

export function Stats() {
  const list = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = list.current;
    if (!root || reduced || typeof IntersectionObserver === "undefined") return;
    const numbers = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
    let frame = 0;
    let first = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.some((entry) => entry.isIntersecting);
        // Already on screen at load: keep the final values rather than replaying them.
        if (first && seen) {
          observer.disconnect();
          return;
        }
        if (first) {
          first = false;
          for (const node of numbers) node.textContent = "0";
          return;
        }
        if (!seen) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / COUNT);
          for (const node of numbers) {
            const target = Number(node.dataset.count);
            node.textContent = String(Math.round(ease(t) * target));
          }
          if (t < 1) frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
      },
      { threshold: 0.1 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      for (const node of numbers) node.textContent = node.dataset.count ?? "";
    };
  }, [reduced]);

  return (
    <section className="section stats" aria-label="auracode in numbers">
      <div className="frame">
        <div className="section-inner">
          <ul className="stats-row" ref={list}>
            {STATS.map((stat) => (
              <li key={stat.label} className="stat">
                <span className="stat-value" data-count={stat.value}>
                  {stat.value}
                </span>
                <span className="stat-label">{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

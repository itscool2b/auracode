import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../motion";

/** Things that stay yours, each true of the desktop app as shipped (see the FAQ below). */
const FACTS = [
  "your agents keep their own sign-ins",
  "chats stay on your computer",
  "the app works offline",
  "your Git index stays untouched",
  "sync is optional and end-to-end encrypted",
  "there is nothing to pay",
] as const;

/**
 * Harvey's wheel, made ours: one sentence that finishes itself as you scroll. The section pins
 * while its facts turn past a fixed line, the one on the line in ink and the rest fading with
 * distance. Without scripts or with reduced motion it is a plain, complete list.
 */
export function Wheel() {
  const section = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const reduced = useReducedMotion();

  const [wide, setWide] = useState(false);
  useEffect(() => {
    // Narrow screens keep the plain list: long facts would wrap into each other on the wheel.
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const node = section.current;
    if (!node || reduced || !wide) {
      setProgress(null);
      return;
    }
    let frame = 0;
    let watching = false;
    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const value = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      setProgress(value);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Only listen while the section is near the screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        const near = entry?.isIntersecting ?? false;
        if (near && !watching) {
          watching = true;
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onScroll);
          measure();
        } else if (!near && watching) {
          watching = false;
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduced, wide]);

  const live = progress !== null;
  const position = live ? progress * (FACTS.length - 1) : 0;

  return (
    <section
      className="section wheel"
      ref={section}
      aria-labelledby="wheel-title"
      data-live={live ? "" : undefined}
      style={{ "--count": FACTS.length } as CSSProperties}
    >
      <div className="wheel-pin">
        <div className="wrap wheel-grid">
          <h2 id="wheel-title" className="wheel-lead">
            With auracode,
          </h2>
          <ul className="wheel-list">
            {FACTS.map((fact, i) => {
              const offset = i - position;
              const distance = Math.min(Math.abs(offset), 3);
              return (
                <li
                  key={fact}
                  className="wheel-item"
                  data-on={live && Math.round(position) === i ? "" : undefined}
                  style={
                    live
                      ? ({
                          "--offset": offset.toFixed(3),
                          "--fade": (1 - distance * 0.3).toFixed(3),
                        } as CSSProperties)
                      : undefined
                  }
                >
                  {fact}.
                </li>
              );
            })}
          </ul>
          <a className="text-link wheel-link" href="#faq">
            Read the answers
          </a>
        </div>
      </div>
    </section>
  );
}

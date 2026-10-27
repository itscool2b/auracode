import { useEffect, useRef } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * Harvey's word wheel, measured from its archived source: timer driven, not scroll linked. Every
 * 1100ms the column moves up one pitch over 600ms on cubic-bezier(0.7, 0, 0.7, 0.7), holds 500ms,
 * then the index advances and the column snaps back with no transition. Seven rows show; the
 * colour by distance from the active row rides the same step.
 */
const MOVE = 600;
const HOLD = 500;
const OFFSETS = [-3, -2, -1, 0, 1, 2, 3, 4];

const wrap = (value: number, length: number) => ((value % length) + length) % length;
const distance = (offset: number) => String(Math.min(3, Math.abs(offset)));

export function AgentWheel({ names }: { names: readonly string[] }) {
  const root = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const active = useRef(0);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(root, { rootMargin: "64px" });

  useEffect(() => {
    const col = column.current;
    if (!col || reduced || !visible || !inView || names.length < 2) return;
    const rows = Array.from(col.children) as HTMLElement[];
    let hold = 0;
    let settle = 0;

    const paint = () => {
      rows.forEach((row, j) => {
        const offset = OFFSETS[j] ?? 0;
        row.textContent = names[wrap(active.current + offset, names.length)] ?? "";
        row.dataset.d = distance(offset);
      });
    };
    const snap = () => {
      settle = 0;
      col.removeAttribute("data-moving");
      active.current = wrap(active.current + 1, names.length);
      col.style.transform = "";
      paint();
      void col.offsetHeight;
    };
    const step = () => {
      col.setAttribute("data-moving", "");
      col.style.transform = "translateY(calc(-1 * var(--wheel-pitch)))";
      rows.forEach((row, j) => {
        row.dataset.d = distance((OFFSETS[j] ?? 0) - 1);
      });
      settle = window.setTimeout(() => {
        snap();
        hold = window.setTimeout(step, HOLD);
      }, MOVE);
    };

    hold = window.setTimeout(step, HOLD);
    return () => {
      window.clearTimeout(hold);
      if (settle) {
        window.clearTimeout(settle);
        snap();
      }
    };
  }, [names, reduced, visible, inView]);

  return (
    <div className="wheel" ref={root} aria-hidden="true">
      <div className="wheel-window">
        <div className="wheel-column" ref={column}>
          {OFFSETS.map((offset) => (
            <span className="wheel-row" key={offset} data-d={distance(offset)}>
              {names[wrap(offset, names.length)]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

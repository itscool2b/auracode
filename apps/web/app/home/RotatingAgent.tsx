import { useEffect, useRef } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * The rotating agent name (x.ai, measured): a swap every 3000ms; the old letters rise 0.23em and
 * fade over 250ms, last letter first, 15ms apart; the new letters arrive from 0.23em below, 25ms
 * apart. The slot takes the new name's width at once and the whole line glides from where it was
 * to where it now centres (a FLIP over 450ms), so only transform and opacity ever animate.
 */
const PERIOD = 3000;
const LETTER = 250;
const EXIT_STAGGER = 15;
const ENTER_STAGGER = 25;
const GLIDE = 450;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const RISE = "0.23em";

function letters(text: string): string[] {
  return Array.from(text).map((char) => (char === " " ? " " : char));
}

function fill(target: HTMLElement, text: string): HTMLElement[] {
  const nodes = letters(text).map((char) => {
    const node = document.createElement("span");
    node.className = "agent-char";
    node.textContent = char;
    return node;
  });
  target.replaceChildren(...nodes);
  return nodes;
}

export function RotatingAgent({ names }: { names: readonly string[] }) {
  const slot = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const index = useRef(0);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(slot);
  const first = names[0] ?? "";

  useEffect(() => {
    const host = slot.current;
    const current = word.current;
    const ruler = measure.current;
    const line = host?.closest<HTMLElement>(".hero-line");
    if (reduced || !visible || !inView || !host || !current || !ruler || !line) return;
    if (names.length < 2) return;
    let timer = 0;
    let swapIn = 0;
    let pending: string | null = null;

    /** Puts `text` in the slot at its own width, with no motion. */
    const settle = (text: string) => {
      const size = Number.parseFloat(getComputedStyle(host).fontSize) || 1;
      fill(ruler, text);
      host.style.width = `${ruler.getBoundingClientRect().width / size}em`;
      return fill(current, text);
    };

    const swap = () => {
      const next = (index.current + 1) % names.length;
      index.current = next;
      const text = names[next] ?? "";
      pending = text;
      const old = Array.from(current.children) as HTMLElement[];
      const last = old.length - 1;
      old.forEach((node, i) => {
        node.animate(
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: `translateY(-${RISE})` },
          ],
          { duration: LETTER, delay: (last - i) * EXIT_STAGGER, easing: EASE_OUT, fill: "both" },
        );
      });
      swapIn = window.setTimeout(
        () => {
          pending = null;
          const before = line.getBoundingClientRect().left;
          const nodes = settle(text);
          const after = line.getBoundingClientRect().left;
          if (Math.abs(before - after) > 0.5)
            line.animate(
              [{ transform: `translateX(${before - after}px)` }, { transform: "translateX(0)" }],
              { duration: GLIDE, easing: EASE_OUT },
            );
          nodes.forEach((node, i) => {
            node.animate(
              [
                { opacity: 0, transform: `translateY(${RISE})` },
                { opacity: 1, transform: "translateY(0)" },
              ],
              { duration: LETTER, delay: i * ENTER_STAGGER, easing: EASE_OUT, fill: "backwards" },
            );
          });
        },
        LETTER + last * EXIT_STAGGER,
      );
      timer = window.setTimeout(swap, PERIOD);
    };

    timer = window.setTimeout(swap, PERIOD);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(swapIn);
      // Stopped between the exit and the entrance: show the next name, still.
      if (pending !== null) settle(pending);
    };
  }, [names, reduced, visible, inView]);

  return (
    <span className="agent-slot" ref={slot}>
      <span className="agent-word" ref={word}>
        {letters(first).map((char, i) => (
          // Letters are positional and never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <span className="agent-char" key={i}>
            {char}
          </span>
        ))}
      </span>
      <span className="agent-measure" ref={measure} />
    </span>
  );
}

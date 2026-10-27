import { useEffect, useRef } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * x.ai's rotating word, measured live (target/design-research/motion.md): a swap every 3000ms; the
 * old letters rise 0.23em (14px at 60px) and fade over 250ms, last letter first, 15ms apart, with a
 * transient 4px blur; the new letters arrive from 0.23em below, 25ms apart; the slot's width morphs
 * over 300ms; the underline's volt glint sweeps once, 3000ms linear, 400ms after each swap.
 */
const PERIOD = 3000;
const LETTER = 250;
const EXIT_STAGGER = 15;
const ENTER_STAGGER = 25;
const GLINT_DELAY = 400;
const GLINT = 3000;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const RISE = "0.23em";

function letters(text: string): string[] {
  return Array.from(text).map((char) => (char === " " ? " " : char));
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
  const rule = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const index = useRef(0);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(slot);
  const first = names[0] ?? "";

  useEffect(() => {
    const host = slot.current;
    const current = word.current;
    const underline = rule.current;
    const ruler = measure.current;
    if (reduced || !visible || !inView || !host || !current || !underline || !ruler) return;
    if (names.length < 2) return;
    let timer = 0;

    const swap = () => {
      const next = (index.current + 1) % names.length;
      index.current = next;
      const text = names[next] ?? "";
      const size = Number.parseFloat(getComputedStyle(host).fontSize) || 1;
      const from = host.getBoundingClientRect().width / size;
      fill(ruler, text);
      const to = ruler.getBoundingClientRect().width / size;
      host.style.transition = "none";
      host.style.width = `${from}em`;
      void host.offsetWidth;
      host.style.transition = "";
      host.style.width = `${to}em`;

      const old = Array.from(current.children) as HTMLElement[];
      const last = old.length - 1;
      old.forEach((node, i) => {
        node.animate(
          [
            { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
            { opacity: 0, transform: `translateY(-${RISE})`, filter: "blur(4px)" },
          ],
          { duration: LETTER, delay: (last - i) * EXIT_STAGGER, easing: EASE_OUT, fill: "both" },
        );
      });
      window.setTimeout(
        () => {
          fill(current, text).forEach((node, i) => {
            node.animate(
              [
                { opacity: 0, transform: `translateY(${RISE})`, filter: "blur(4px)" },
                { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
              ],
              { duration: LETTER, delay: i * ENTER_STAGGER, easing: EASE_OUT, fill: "backwards" },
            );
          });
        },
        LETTER + last * EXIT_STAGGER,
      );
      underline.animate([{ backgroundPosition: "150% 0" }, { backgroundPosition: "-150% 0" }], {
        duration: GLINT,
        delay: GLINT_DELAY,
        easing: "linear",
        fill: "backwards",
      });
      timer = window.setTimeout(swap, PERIOD);
    };

    timer = window.setTimeout(swap, PERIOD);
    return () => window.clearTimeout(timer);
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
      <span className="agent-rule" ref={rule} />
      <span className="agent-measure" ref={measure} />
    </span>
  );
}

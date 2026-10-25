import { Brain, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { formatDuration, type ThoughtItem } from "../../kit";
import { Markdown } from "./Markdown";
import { thoughtParts } from "./text";
import { Expand, reveal, useReduced } from "./ui";

/**
 * The agent's reasoning as one quiet step. While it thinks, the label shimmers and the newest
 * lines scroll through a three-line window ruled in the agent's colour (the turn's clock in the
 * byline is the only counter). When the thought ends it folds into "Thought for 6s", which opens
 * the whole thought on click.
 */
export const ThoughtStep = memo(function ThoughtStep({ item }: { readonly item: ThoughtItem }) {
  const reduced = useReduced();
  const [open, setOpen] = useState(false);
  const thinking = item.durationMs === null;
  const { title, body } = thoughtParts(item.text);
  const label = thinking
    ? (title ?? "Thinking")
    : `Thought for ${formatDuration(item.durationMs ?? 0)}`;

  return (
    <div className="n-step-block" data-kind="thought" data-live={thinking ? "" : undefined}>
      <button
        type="button"
        className="n-step"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="n-step-glyph" aria-hidden="true">
          <Brain size={14} strokeWidth={1.6} />
        </span>
        <span className="n-step-label" data-shimmer={thinking && !reduced ? "" : undefined}>
          {label}
        </span>
        <ChevronRight className="n-step-chev" size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {thinking && !open ? (
          <motion.div key="preview" className="n-step-body" {...reveal(reduced)}>
            <ThoughtWindow text={body} streaming={item.streaming} reduced={reduced} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Expand open={open} follow>
        <div className="n-thought-full">
          {title && !thinking ? <p className="n-thought-title">{title}</p> : null}
          <Markdown text={body} streaming={item.streaming} variant="thought" animate={false} />
        </div>
      </Expand>
    </div>
  );
});

/** Three lines of thought text, at 20 px each. */
const WINDOW_HEIGHT = 60;

/**
 * The newest lines of a thought in progress, three at most. The text is anchored at its top and
 * slid up by however much no longer fits, so each new line glides in from below (a transform
 * transition, never a scroll), with a fade over the top once there is more than fits.
 */
function ThoughtWindow({
  text,
  streaming,
  reduced,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly reduced: boolean;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Measured whenever the text's box changes size (a new line, a font arriving), before paint.
  useLayoutEffect(() => {
    const frame = windowRef.current;
    const inner = innerRef.current;
    if (!frame || !inner) return;
    const measure = (): void => {
      const offset = Math.max(0, inner.offsetHeight - WINDOW_HEIGHT);
      inner.style.transform = offset > 0 ? `translateY(${-offset}px)` : "";
      if (offset > 0) frame.dataset.overflow = "";
      else delete frame.dataset.overflow;
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="n-thought-window" ref={windowRef}>
      <div ref={innerRef} className="n-thought-inner" data-reduced={reduced ? "" : undefined}>
        <Markdown text={text} streaming={streaming} variant="thought" animate={!reduced} />
      </div>
    </div>
  );
}

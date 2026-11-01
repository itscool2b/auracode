import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect;

/**
 * A name that rolls letter by letter when it changes: the old letters lift away and the new ones
 * rise in behind them, one after another. The line's width glides from one name to the next, so a
 * centred headline never jumps. Decorative: the heading's label carries the words.
 */
export function AgentRoll({ name }: { name: string }) {
  const [shown, setShown] = useState({ current: name, previous: "", turn: 0 });
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  if (name !== shown.current) {
    setShown({ current: name, previous: shown.current, turn: shown.turn + 1 });
  }

  useIsoLayoutEffect(() => {
    const node = measure.current;
    if (node) setWidth(node.getBoundingClientRect().width);
  }, [shown.current]);

  // Fonts can arrive after the first measure; measure again once they have.
  useIsoLayoutEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      const node = measure.current;
      if (!cancelled && node) setWidth(node.getBoundingClientRect().width);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const letters = (text: string, kind: "in" | "out") =>
    Array.from(text).map((char, i) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is identity.
        key={i}
        className={`roll-char roll-${kind}`}
        style={{ "--i": i } as CSSProperties}
      >
        {char === " " ? " " : char}
      </span>
    ));

  return (
    <span
      className="roll"
      style={width === null ? undefined : ({ "--roll-w": `${width}px` } as CSSProperties)}
      data-measured={width === null ? undefined : ""}
    >
      <span className="roll-measure" ref={measure} aria-hidden="true">
        {shown.current}.
      </span>
      {shown.turn > 0 ? (
        <span className="roll-word roll-word-out" key={`out-${shown.turn}`} aria-hidden="true">
          {letters(`${shown.previous}.`, "out")}
        </span>
      ) : null}
      <span
        className="roll-word"
        key={`in-${shown.turn}`}
        data-rolling={shown.turn > 0 ? "" : undefined}
      >
        {shown.turn > 0 ? letters(`${shown.current}.`, "in") : `${shown.current}.`}
      </span>
    </span>
  );
}

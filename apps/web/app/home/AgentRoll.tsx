import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect;

/** A split word's space keeps its width as a box of its own. */
const NBSP = " ";

/**
 * How far each letter of a set word sits from where it would fall on its own: the face's kerning.
 * The word is read twice from the hidden measures, once as text (kerned, through a Range per
 * letter) and once split into boxes (each letter's own advance). Letter i takes the difference as
 * its left margin, so a word split for the roll keeps the spacing of the word as it is set.
 */
function readKerning(text: HTMLElement | null, split: HTMLElement | null): number[] {
  const node = text?.firstChild;
  if (!split || !(node instanceof Text)) return [];
  const boxes = Array.from(split.children) as HTMLElement[];
  const range = document.createRange();
  const left = (i: number) => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    return range.getBoundingClientRect().left;
  };
  // The names are ASCII, so one UTF-16 unit is one letter, and the boxes match them one to one.
  if (boxes.length !== node.data.length) return [];
  const margins = [0];
  for (let i = 1; i < boxes.length; i++) {
    const own = (boxes[i - 1] as HTMLElement).getBoundingClientRect().width;
    margins.push(Number((left(i) - left(i - 1) - own).toFixed(2)));
  }
  return margins;
}

/**
 * A name that rolls letter by letter when it changes: the old letters lift away and the new ones
 * rise in behind them, one after another. The line's width glides from one name to the next, so a
 * centred headline never jumps, and the split letters keep the face's kerning. Decorative: the
 * heading's label carries the words.
 */
export function AgentRoll({ name }: { name: string }) {
  const [shown, setShown] = useState({ current: name, previous: "", turn: 0 });
  const measure = useRef<HTMLSpanElement>(null);
  const measureSplit = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [kerning, setKerning] = useState<Record<string, number[]>>({});

  if (name !== shown.current) {
    setShown({ current: name, previous: shown.current, turn: shown.turn + 1 });
  }

  const read = () => {
    const node = measure.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const word = `${shown.current}.`;
    const margins = readKerning(node, measureSplit.current);
    setKerning((known) =>
      known[word]?.join() === margins.join() ? known : { ...known, [word]: margins },
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: read runs for each new name.
  useIsoLayoutEffect(read, [shown.current]);

  // Fonts can arrive after the first measure; measure again once they have.
  useIsoLayoutEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) read();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const letters = (text: string, kind: "in" | "out") => {
    const margins = kerning[text];
    return Array.from(text).map((char, i) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is identity.
        key={i}
        className={`roll-char roll-${kind}`}
        style={
          { "--i": i, marginLeft: margins?.[i] ? `${margins[i]}px` : undefined } as CSSProperties
        }
      >
        {char === " " ? NBSP : char}
      </span>
    ));
  };

  return (
    <span
      className="roll"
      style={width === null ? undefined : ({ "--roll-w": `${width}px` } as CSSProperties)}
      data-measured={width === null ? undefined : ""}
    >
      <span className="roll-measure" ref={measure} aria-hidden="true">
        {`${shown.current}.`}
      </span>
      <span className="roll-measure roll-measure-split" ref={measureSplit} aria-hidden="true">
        {Array.from(`${shown.current}.`).map((char, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is identity.
          <span key={i} className="roll-char">
            {char === " " ? NBSP : char}
          </span>
        ))}
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

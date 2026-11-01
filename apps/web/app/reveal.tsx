import type { CSSProperties } from "react";

/**
 * Words that rise into place, one after another, when their block scrolls into view. Each word
 * sits in its own mask, so the line reads cleanly at every point of the rise. The text stays one
 * readable string for assistive technology; without scripts or motion it simply shows.
 */
export function Words({ text, offset = 0 }: { text: string; offset?: number }) {
  const words = text.split(" ");
  return (
    <span className="words" data-reveal="words">
      {words.map((word, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; the position is identity.
        <span key={i}>
          <span className="w">
            <span className="w-in" style={{ "--w": i + offset } as CSSProperties}>
              {word}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

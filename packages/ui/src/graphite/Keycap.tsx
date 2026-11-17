import type { ReactNode } from "react";

export interface KeycapProps {
  readonly children?: ReactNode;
  /** Spoken name when the glyph alone is unclear to a screen reader, such as "Command". */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Key symbols drawn as strokes on a 24 grid. Geist Mono has none of ⌘ ⇧ ↵ ⌥ ⌃ ← →, so as text they
 * fall back to whatever font the system has (Liberation Sans on a stock Arch desktop) and sit off
 * the cap's baseline at another weight. Drawn, they take the cap's ink and size on every system.
 */
const KEY_GLYPHS: Readonly<Record<string, { readonly name: string; readonly d: string }>> = {
  "⌘": {
    name: "Command",
    d: "M9 9V6A3 3 0 1 0 6 9H18A3 3 0 1 0 15 6V18A3 3 0 1 0 18 15H6A3 3 0 1 0 9 18Z",
  },
  "⇧": { name: "Shift", d: "M12 4L20 12H16V20H8V12H4Z" },
  "↵": { name: "Enter", d: "M19 5V11A3 3 0 0 1 16 14H5M9 10L5 14L9 18" },
  "⌥": { name: "Option", d: "M4 7H9L15 17H20M14 7H20" },
  "⌃": { name: "Control", d: "M6 15L12 9L18 15" },
  "←": { name: "Left", d: "M19 12H5M11 6L5 12L11 18" },
  "→": { name: "Right", d: "M5 12H19M13 6L19 12L13 18" },
  "↑": { name: "Up", d: "M12 19V5M6 11L12 5L18 11" },
  "↓": { name: "Down", d: "M12 5V19M6 13L12 19L18 13" },
  "⌫": {
    name: "Delete",
    d: "M9 6H19A1 1 0 0 1 20 7V17A1 1 0 0 1 19 18H9L3 12ZM12 10L16 14M16 10L12 14",
  },
};

/**
 * One key, in Geist Mono 11/16 500 on a small cap; a key symbol is drawn as an icon in the same ink
 * (KEY_GLYPHS) and named for screen readers. Use one Keycap per key in a chord.
 */
export function Keycap({ children, label, className }: KeycapProps) {
  const glyph = typeof children === "string" ? KEY_GLYPHS[children] : undefined;
  return (
    <kbd
      className={className ? `g-keycap ${className}` : "g-keycap"}
      aria-label={label ?? glyph?.name}
    >
      {glyph ? (
        <svg
          className="g-keycap-glyph"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={glyph.d} />
        </svg>
      ) : (
        children
      )}
    </kbd>
  );
}

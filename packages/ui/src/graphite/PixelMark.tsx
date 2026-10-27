import { fitGrid, gridPath, PIXEL_MARK_GRID } from "./pixels";

export interface PixelMarkProps {
  /** Box size in px. Crisp at 12, 16, 20, 24, 32 and any multiple of 6. Default 20. */
  readonly size?: number;
  readonly className?: string;
  /** Accessible name; without one the mark is decorative. */
  readonly label?: string;
}

/** The auracode glyph in `currentColor`, its pixels laid on whole CSS pixels at every size. */
export function PixelMark({ size = 20, className, label }: PixelMarkProps) {
  const box = Number.isFinite(size) ? Math.max(6, Math.min(512, Math.round(size))) : 20;
  const { cell, offset } = fitGrid(box, PIXEL_MARK_GRID.length);
  return (
    <svg
      className={className ? `g-pixel-mark ${className}` : "g-pixel-mark"}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={gridPath(PIXEL_MARK_GRID, cell, offset)} />
    </svg>
  );
}

export interface WordmarkProps {
  /** Font size of "auracode" in px. Default 16. */
  readonly size?: number;
  /** Show the pixel glyph before the word. Default true. */
  readonly mark?: boolean;
  readonly className?: string;
}

/**
 * "auracode" in Geist 600 with tight tracking, after the pixel glyph. The word is real text, so a
 * wordmark inside a link names the link. The glyph is sized to a whole number of 6px steps near
 * three quarters of the type size, so it stays crisp and sits on the baseline like a letter.
 */
export function Wordmark({ size = 16, mark = true, className }: WordmarkProps) {
  const fontSize = Number.isFinite(size) ? Math.max(10, Math.min(320, size)) : 16;
  const glyph = 6 * Math.max(2, Math.round((fontSize * 0.75) / 6));
  return (
    <span
      className={className ? `g-wordmark ${className}` : "g-wordmark"}
      style={{ fontSize: `${fontSize}px` }}
    >
      {mark ? <PixelMark size={glyph} /> : null}
      <span className="g-wordmark-text">auracode</span>
    </span>
  );
}

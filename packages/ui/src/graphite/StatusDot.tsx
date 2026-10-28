import type { ReactNode } from "react";
import { type LoaderTempo, PixelLoader } from "./PixelLoader";

export type StatusTone = "neutral" | "volt" | "green" | "red";

export interface StatusDotProps {
  /** neutral (grey), volt (needs you, new), green (passed), red (failed). Default "neutral". */
  readonly tone?: StatusTone;
  /** Show the walking 2x3 loader instead of a still dot, its head in the tone. */
  readonly live?: boolean;
  readonly tempo?: LoaderTempo;
  /** Diameter in px; a live loader uses a box twice as large. Default 6. */
  readonly size?: number;
  /** Accessible name; without one the dot is decorative and the text beside it speaks. */
  readonly label?: string;
  readonly className?: string;
}

/** A status dot: a flat circle, never a glow. A live one is the pixel loader. */
export function StatusDot({
  tone = "neutral",
  live = false,
  tempo = "tool",
  size = 6,
  label,
  className,
}: StatusDotProps): ReactNode {
  const side = Number.isFinite(size) ? Math.max(4, Math.min(32, Math.round(size))) : 6;
  if (live) {
    return (
      <PixelLoader
        size={Math.max(12, side * 2)}
        tone={tone}
        tempo={tempo}
        label={label}
        className={className ? `g-status-live ${className}` : "g-status-live"}
      />
    );
  }
  const semantics = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span
      className={className ? `g-status-dot ${className}` : "g-status-dot"}
      data-tone={tone}
      style={{ width: `${side}px`, height: `${side}px` }}
      {...semantics}
    />
  );
}

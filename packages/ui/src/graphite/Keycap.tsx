import type { ReactNode } from "react";

export interface KeycapProps {
  readonly children?: ReactNode;
  /** Spoken name when the glyph alone is unclear to a screen reader, such as "Command". */
  readonly label?: string;
  readonly className?: string;
}

/** One key, in Geist Mono 11/16 500 on a small raised cap. Use one Keycap per key in a chord. */
export function Keycap({ children, label, className }: KeycapProps) {
  return (
    <kbd className={className ? `g-keycap ${className}` : "g-keycap"} aria-label={label}>
      {children}
    </kbd>
  );
}

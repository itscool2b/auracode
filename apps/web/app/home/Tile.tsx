import { DitherField } from "@auracode/ui/graphite";
import type { ReactNode } from "react";
import { GRAIN_FIELD } from "../fields";

/**
 * A recessed tile on dim grain, Harvey's textured tiles drawn by a still dither field. Its contents
 * illustrate the caption beside or below it, so the tile itself is hidden from assistive tech.
 */
export function GrainTile({
  seed,
  className,
  children,
}: {
  seed: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `tile ${className}` : "tile"} aria-hidden="true">
      <DitherField
        className="tile-grain"
        cell={GRAIN_FIELD.cell}
        density={GRAIN_FIELD.density}
        accent={GRAIN_FIELD.accent}
        palette={GRAIN_FIELD.palette}
        ceiling={GRAIN_FIELD.ceiling}
        seed={seed}
        transparent
        still
      />
      <div className="tile-body">{children}</div>
    </div>
  );
}

import {
  CREATURE_SMALL_MAX,
  SEAL_PATH,
  SEAL_SMALL_PATH,
  SEAL_VIEWBOX,
  TURTLE_PATH,
  TURTLE_SMALL_PATH,
  TURTLE_VIEWBOX,
} from "./creaturePaths";

export type CreatureKind = "seal" | "turtle";

const DRAWINGS = {
  seal: { viewBox: SEAL_VIEWBOX, path: SEAL_PATH, small: SEAL_SMALL_PATH },
  turtle: { viewBox: TURTLE_VIEWBOX, path: TURTLE_PATH, small: TURTLE_SMALL_PATH },
} as const;

/** A creature's height for a given width, from its viewBox. */
export function creatureHeight(kind: CreatureKind, width: number): number {
  const [w, h] = DRAWINGS[kind].viewBox;
  return (width * h) / w;
}

export interface CreatureProps {
  readonly kind: CreatureKind;
  /**
   * Width in px. At CREATURE_SMALL_MAX (64) and below it draws the small variant, whose gaps stay
   * open. Leave it out to fill the parent's width (the full drawing); `small` then picks the
   * variant.
   */
  readonly size?: number;
  /** Force the small variant, for a creature sized by CSS at icon sizes. */
  readonly small?: boolean;
  /** Which way it faces. Default "right". */
  readonly facing?: "right" | "left";
  readonly className?: string;
  /** Accessible name; without one the creature is decorative. */
  readonly label?: string;
}

/**
 * A seal or a sea turtle as one flat silhouette in `currentColor` (visual language 4.16). Same
 * language as the logo: solid shapes, even gaps between body and flippers, one eye hole.
 */
export function Creature({ kind, size, small, facing = "right", className, label }: CreatureProps) {
  const drawing = DRAWINGS[kind];
  const [w, h] = drawing.viewBox;
  const width =
    size === undefined || !Number.isFinite(size)
      ? undefined
      : Math.max(8, Math.min(2048, Math.round(size)));
  const useSmall = small ?? (width !== undefined && width <= CREATURE_SMALL_MAX);
  return (
    <svg
      className={className ? `g-creature ${className}` : "g-creature"}
      width={width}
      height={width === undefined ? undefined : Math.round(creatureHeight(kind, width))}
      viewBox={`0 0 ${w} ${h}`}
      fill="currentColor"
      data-facing={facing}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d={useSmall ? drawing.small : drawing.path} />
    </svg>
  );
}

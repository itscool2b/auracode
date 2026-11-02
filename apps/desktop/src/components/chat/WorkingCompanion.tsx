import { Creature, type CreatureKind } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";

/** How the companion swims one lap: each reads differently at a glance. */
export type CompanionPath = "cruise" | "porpoise" | "roll" | "glide" | "bob" | "dip";

export interface CompanionVariant {
  readonly kind: CreatureKind;
  readonly path: CompanionPath;
  readonly heading: "right" | "left";
  /** The lap's length against --g-dur-swim. */
  readonly pace: number;
}

/** Which swims suit which creature: a sea lion leaps and rolls, a turtle glides and paddles. */
const PATHS: Readonly<Record<CreatureKind, readonly CompanionPath[]>> = {
  seal: ["cruise", "porpoise", "roll"],
  turtle: ["glide", "bob", "dip"],
};
const PACES = [0.85, 1, 1.2] as const;

/**
 * A new swim for each turn (owner, 2 November 2026): the logo's sea lion or turtle, one of its
 * three ways of moving, either direction, at one of three paces. `random` is injectable for tests.
 */
export function companionVariant(random: () => number = Math.random): CompanionVariant {
  const pick = <T,>(items: readonly T[]): T =>
    items[Math.min(items.length - 1, Math.floor(random() * items.length))] as T;
  const kind = pick<CreatureKind>(["seal", "turtle"]);
  return {
    kind,
    path: pick(PATHS[kind]),
    heading: pick(["right", "left"] as const),
    pace: pick(PACES),
  };
}

/**
 * The working agent's companion: a sea lion or turtle in the logo's flat style, swimming laps
 * along the composer's top rim while a turn runs, in neutral ink. It replaced the rim's brand-colour
 * glow. Decorative; the working line says the agent is working. Under reduced motion it rests at
 * the start of its lane.
 */
export function WorkingCompanion({ variant }: { readonly variant: CompanionVariant }) {
  return (
    <span
      className="chat-companion"
      data-testid="working-companion"
      data-kind={variant.kind}
      data-path={variant.path}
      data-heading={variant.heading}
      style={{ "--companion-pace": variant.pace } as CSSProperties}
      aria-hidden="true"
    >
      <span className="chat-companion-track">
        <span className="chat-companion-body">
          <Creature kind={variant.kind} size={variant.kind === "seal" ? 38 : 32} />
        </span>
      </span>
    </span>
  );
}

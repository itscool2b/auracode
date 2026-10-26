import { lazy } from "react";
import { CORE_STATES } from "../lab/states";
import type { LabTheme } from "../lab/theme";
import { DEFAULT_WALLPAPER } from "../shared/wallpapers";
import { meta as aurora } from "./aurora/meta";
import { meta as halo } from "./halo/meta";
import { meta as noir } from "./noir/meta";
import { meta as orbit } from "./orbit/meta";
import type { Direction, DirectionCard } from "./types";

const DARK_ONLY: readonly LabTheme[] = ["dark"];

/** A name card with its defaults filled in: the core states, dark only, the default wallpaper. */
function register(id: string, card: DirectionCard, App: Direction["App"]): Direction {
  return {
    id,
    name: card.name,
    tagline: card.tagline,
    states: card.states ?? CORE_STATES,
    themes: card.themes ?? DARK_ONLY,
    wallpaper: card.wallpaper ?? DEFAULT_WALLPAPER,
    App,
  };
}

/**
 * The direction the owner chose to graduate into the real UI in M2a. The gallery opens with it and
 * marks it as chosen; the others stay for comparison.
 */
export const CHOSEN_DIRECTION_ID = "orbit";

/**
 * Every direction, in gallery order (the chosen one first, then the rest in the order they were made): id -> { id, name, tagline, states, themes, wallpaper, App }.
 * Shared: designers edit their own folder (App.tsx, meta.ts), never this file.
 *
 * Each App loads lazily, so a page only runs (and styles itself with) the direction it shows, and a
 * direction that fails to compile mid-edit breaks only its own pages in the dev server.
 */
export const DIRECTIONS: readonly Direction[] = [
  register(
    "orbit",
    orbit,
    lazy(() => import("./orbit/App").then((module) => ({ default: module.App }))),
  ),
  register(
    "aurora",
    aurora,
    lazy(() => import("./aurora/App").then((module) => ({ default: module.App }))),
  ),
  register(
    "noir",
    noir,
    lazy(() => import("./noir/App").then((module) => ({ default: module.App }))),
  ),
  register(
    "halo",
    halo,
    lazy(() => import("./halo/App").then((module) => ({ default: module.App }))),
  ),
];

/** Directions by id. A Map, so ids like "constructor" never resolve to Object members. */
export const DIRECTIONS_BY_ID: ReadonlyMap<string, Direction> = new Map(
  DIRECTIONS.map((direction) => [direction.id, direction] as const),
);

export function getDirection(id: string): Direction | null {
  return DIRECTIONS_BY_ID.get(id) ?? null;
}

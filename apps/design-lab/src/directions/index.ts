import { lazy } from "react";
import { meta as aurora } from "./aurora/meta";
import { meta as halo } from "./halo/meta";
import { meta as noir } from "./noir/meta";
import type { Direction } from "./types";

/**
 * Every direction, in gallery order: id -> { id, name, tagline, App }. Shared: designers edit their
 * own folder (App.tsx, meta.ts), never this file.
 *
 * Each App loads lazily, so a page only runs (and styles itself with) the direction it shows, and a
 * direction that fails to compile mid-edit breaks only its own pages in the dev server.
 */
export const DIRECTIONS: readonly Direction[] = [
  {
    id: "aurora",
    ...aurora,
    App: lazy(() => import("./aurora/App").then((module) => ({ default: module.App }))),
  },
  {
    id: "noir",
    ...noir,
    App: lazy(() => import("./noir/App").then((module) => ({ default: module.App }))),
  },
  {
    id: "halo",
    ...halo,
    App: lazy(() => import("./halo/App").then((module) => ({ default: module.App }))),
  },
];

/** Directions by id. A Map, so ids like "constructor" never resolve to Object members. */
export const DIRECTIONS_BY_ID: ReadonlyMap<string, Direction> = new Map(
  DIRECTIONS.map((direction) => [direction.id, direction] as const),
);

export function getDirection(id: string): Direction | null {
  return DIRECTIONS_BY_ID.get(id) ?? null;
}

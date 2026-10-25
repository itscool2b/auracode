import { clampSpeed } from "../model/player";
import { DEFAULT_WALLPAPER, isWallpaperId, type WallpaperId } from "../shared/wallpapers";
import { CORE_STATES, isLabState, type LabState } from "./states";
import { DEFAULT_THEME, isLabTheme, type LabTheme } from "./theme";

/**
 * The lab's URL scheme, all in the hash so any static server works:
 *
 *   #/                                  the gallery
 *   #/<direction>                       that direction, in its first state (streaming)
 *   #/<direction>/<state>?<params>      that direction in one state
 *
 * Params (all optional):
 *   t=<seconds>       freeze the playhead there (deterministic screenshots)
 *   speed=<n>         playback rate, 0.1 to 16 (default 1)
 *   motion=reduce     render as if the OS asked for reduced motion
 *   play=1 | play=0   force playback on (plays and loops any state) or off
 *   hud=1 | hud=0     pin the lab controls open, or hide them (default: shown near the bottom edge)
 *   wall=<id>         wallpaper: dusk, dawn, graphite, satin (default: the direction's own, else dusk)
 *   theme=<id>        dark (default) or light
 *   thumb=1           gallery thumbnail: tight margins, no controls
 */
export interface StageRoute {
  readonly kind: "stage";
  readonly direction: string;
  readonly state: LabState;
  /** Where to freeze the playhead, in seconds, or null for the state's own playback. */
  readonly t: number | null;
  readonly speed: number;
  readonly reducedMotion: boolean;
  readonly play: boolean | null;
  readonly hud: boolean | null;
  readonly wallpaper: WallpaperId;
  readonly theme: LabTheme;
  readonly thumb: boolean;
}

export type LabRoute =
  | { readonly kind: "gallery" }
  | StageRoute
  | { readonly kind: "not-found"; readonly message: string };

/**
 * What the route needs to know about a direction. A bare id stands for a direction with the core
 * states and the default wallpaper.
 */
export interface RouteDirection {
  readonly id: string;
  readonly states?: readonly LabState[];
  readonly wallpaper?: WallpaperId;
}

function flag(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return null;
}

function seconds(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function routeDirection(entry: string | RouteDirection): RouteDirection {
  return typeof entry === "string" ? { id: entry } : entry;
}

/** Reads a hash (with or without the leading `#`) against the known directions. */
export function parseRoute(
  hash: string,
  directions: readonly (string | RouteDirection)[],
): LabRoute {
  const raw = hash.replace(/^#/, "");
  const queryStart = raw.indexOf("?");
  const path = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const query = new URLSearchParams(queryStart === -1 ? "" : raw.slice(queryStart + 1));
  const segments = path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter((segment) => segment !== "");

  if (segments.length === 0) return { kind: "gallery" };
  const [direction = "", stateSegment, ...rest] = segments;
  // A plain loop, so ids like "constructor" never match Object members.
  let entry: RouteDirection | null = null;
  for (const candidate of directions) {
    const info = routeDirection(candidate);
    if (info.id === direction) {
      entry = info;
      break;
    }
  }
  if (!entry) {
    return { kind: "not-found", message: `There is no direction called "${direction}".` };
  }
  const supported = entry.states ?? CORE_STATES;
  const state = stateSegment ?? supported[0] ?? "streaming";
  if (!isLabState(state)) {
    return { kind: "not-found", message: `There is no state called "${state}".` };
  }
  if (!supported.includes(state)) {
    return {
      kind: "not-found",
      message: `The ${direction} direction has no "${state}" state.`,
    };
  }
  if (rest.length > 0) {
    return { kind: "not-found", message: `The path "/${segments.join("/")}" goes too deep.` };
  }

  const wallpaper = query.get("wall");
  const theme = query.get("theme")?.trim().toLowerCase() ?? null;
  return {
    kind: "stage",
    direction,
    state,
    t: seconds(query.get("t")),
    speed: clampSpeed(Number(query.get("speed") ?? "1")),
    reducedMotion: query.get("motion")?.trim().toLowerCase() === "reduce",
    play: flag(query.get("play")),
    hud: flag(query.get("hud")),
    wallpaper:
      wallpaper !== null && isWallpaperId(wallpaper)
        ? wallpaper
        : (entry.wallpaper ?? DEFAULT_WALLPAPER),
    theme: theme !== null && isLabTheme(theme) ? theme : DEFAULT_THEME,
    thumb: flag(query.get("thumb")) === true,
  };
}

export interface StageLink {
  readonly direction: string;
  readonly state: LabState;
  readonly t?: number | null;
  readonly speed?: number;
  readonly reducedMotion?: boolean;
  readonly play?: boolean | null;
  readonly hud?: boolean | null;
  readonly wallpaper?: WallpaperId;
  /**
   * The wallpaper the direction opens on by itself (its meta.ts `wallpaper`), so the link leaves
   * `wall` out exactly when the page would pick it anyway. Defaults to the lab's.
   */
  readonly defaultWallpaper?: WallpaperId;
  readonly theme?: LabTheme;
  readonly thumb?: boolean;
}

/** The hash for a stage, leaving defaults out: `#/aurora/streaming?t=7.5`. */
export function stageHref(link: StageLink): string {
  const params: string[] = [];
  if (link.t !== undefined && link.t !== null) params.push(`t=${link.t}`);
  if (link.speed !== undefined && link.speed !== 1) params.push(`speed=${link.speed}`);
  if (link.reducedMotion) params.push("motion=reduce");
  if (link.play !== undefined && link.play !== null) params.push(`play=${link.play ? 1 : 0}`);
  if (link.hud !== undefined && link.hud !== null) params.push(`hud=${link.hud ? 1 : 0}`);
  if (
    link.wallpaper !== undefined &&
    link.wallpaper !== (link.defaultWallpaper ?? DEFAULT_WALLPAPER)
  ) {
    params.push(`wall=${link.wallpaper}`);
  }
  if (link.theme !== undefined && link.theme !== DEFAULT_THEME) params.push(`theme=${link.theme}`);
  if (link.thumb) params.push("thumb=1");
  const path = `#/${encodeURIComponent(link.direction)}/${link.state}`;
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
}

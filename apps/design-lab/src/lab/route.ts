import { clampSpeed } from "../model/player";
import { isWallpaperId, type WallpaperId } from "../shared/wallpapers";
import { isLabState, type LabState } from "./states";

/**
 * The lab's URL scheme, all in the hash so any static server works:
 *
 *   #/                                  the gallery
 *   #/<direction>                       that direction, streaming
 *   #/<direction>/<state>?<params>      that direction in one state
 *
 * Params (all optional):
 *   t=<seconds>       freeze the playhead there (deterministic screenshots)
 *   speed=<n>         playback rate, 0.1 to 16 (default 1)
 *   motion=reduce     render as if the OS asked for reduced motion
 *   play=1 | play=0   force playback on (plays and loops any state) or off
 *   hud=1 | hud=0     pin the lab controls open, or hide them (default: shown near the bottom edge)
 *   wall=<id>         wallpaper: dusk (default), dawn, graphite
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
  readonly thumb: boolean;
}

export type LabRoute =
  | { readonly kind: "gallery" }
  | StageRoute
  | { readonly kind: "not-found"; readonly message: string };

const DEFAULT_WALLPAPER: WallpaperId = "dusk";

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

/** Reads a hash (with or without the leading `#`) against the known direction ids. */
export function parseRoute(hash: string, directions: readonly string[]): LabRoute {
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
  const [direction = "", state = "streaming", ...rest] = segments;
  if (!directions.includes(direction)) {
    return { kind: "not-found", message: `There is no direction called "${direction}".` };
  }
  if (!isLabState(state)) {
    return { kind: "not-found", message: `There is no state called "${state}".` };
  }
  if (rest.length > 0) {
    return { kind: "not-found", message: `The path "/${segments.join("/")}" goes too deep.` };
  }

  const wallpaper = query.get("wall");
  return {
    kind: "stage",
    direction,
    state,
    t: seconds(query.get("t")),
    speed: clampSpeed(Number(query.get("speed") ?? "1")),
    reducedMotion: query.get("motion")?.trim().toLowerCase() === "reduce",
    play: flag(query.get("play")),
    hud: flag(query.get("hud")),
    wallpaper: wallpaper !== null && isWallpaperId(wallpaper) ? wallpaper : DEFAULT_WALLPAPER,
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
  if (link.wallpaper !== undefined && link.wallpaper !== DEFAULT_WALLPAPER) {
    params.push(`wall=${link.wallpaper}`);
  }
  if (link.thumb) params.push("thumb=1");
  const path = `#/${encodeURIComponent(link.direction)}/${link.state}`;
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
}

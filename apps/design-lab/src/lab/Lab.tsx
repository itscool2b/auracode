import "./lab.css";
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { DIRECTIONS } from "../directions";
import { Gallery } from "./Gallery";
import { setReducedMotionOverride } from "./reducedMotion";
import { parseRoute } from "./route";
import { Stage } from "./Stage";

const DIRECTION_IDS = DIRECTIONS.map((direction) => direction.id);

function subscribeHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

const readHash = (): string => window.location.hash;
const serverHash = (): string => "";

/** The lab's root: reads the hash and shows the gallery or one direction in one state. */
export function Lab() {
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  const route = useMemo(() => parseRoute(hash, DIRECTION_IDS), [hash]);
  const reduced = route.kind === "stage" && route.reducedMotion;

  // Before paint, so the first frame of a page already renders with the right motion setting.
  useLayoutEffect(() => {
    setReducedMotionOverride(reduced);
  }, [reduced]);

  useLayoutEffect(() => {
    document.title =
      route.kind === "stage"
        ? `${route.direction} / ${route.state} · design lab`
        : "auracode design lab";
  }, [route]);

  if (route.kind === "gallery") return <Gallery />;
  if (route.kind === "not-found") {
    return (
      <div className="lab-missing">
        <p className="lab-missing-title">Nothing here</p>
        <p>{route.message}</p>
        <a href="#/">Back to the gallery</a>
      </div>
    );
  }
  // A new direction or state starts fresh: its own player, and the direction's local UI state reset.
  return <Stage key={`${route.direction}/${route.state}`} route={route} />;
}

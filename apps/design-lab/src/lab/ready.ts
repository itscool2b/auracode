import { useEffect } from "react";

/**
 * The handshake with scripts/shoot.mjs, on the root element:
 * - `data-lab-ready="true"` once the direction has mounted,
 * - `data-lab-ready="error"` (with `data-lab-error`) when it crashed,
 * - `data-lab-ready="false"` otherwise (loading, or switching pages).
 * The script then waits for fonts, live orbs, and finished animations itself.
 */
export function markReady(ready: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.labReady = ready ? "true" : "false";
  delete root.dataset.labError;
}

export function markError(message: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.labReady = "error";
  root.dataset.labError = message;
}

/** Rendered after the direction's App inside the same Suspense boundary: mounts once it has. */
export function ReadyMarker() {
  useEffect(() => {
    markReady(true);
    return () => markReady(false);
  }, []);
  return null;
}

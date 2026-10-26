import { useSyncExternalStore } from "react";

export type OrbitTheme = "light" | "dark";

function media(): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia("(prefers-color-scheme: dark)");
}

function subscribe(onChange: () => void): () => void {
  const query = media();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const snapshot = (): OrbitTheme => (media()?.matches ? "dark" : "light");
const serverSnapshot = (): OrbitTheme => "light";

/** Follows system appearance, including changes while a native window stays open. */
export function useOrbitTheme(): OrbitTheme {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

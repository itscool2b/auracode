import type { AppearancePreference } from "../bindings";

export type ResolvedAppearance = "light" | "dark";
const PREVIEW_KEY = "auracode.preview.appearance";

export function isAppearance(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

type Media = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

/** The OS subscription stays live, but an explicit preference never follows OS changes. */
export function createAppearanceController(
  media: Media,
  initial: AppearancePreference,
  apply: (resolved: ResolvedAppearance) => void,
  persist: (preference: AppearancePreference) => void = () => {},
) {
  let preference = initial;
  let resolved = resolveAppearance(preference, media.matches);
  const listeners = new Set<() => void>();
  apply(resolved);
  const update = () => {
    const next = resolveAppearance(preference, media.matches);
    if (next === resolved) return;
    resolved = next;
    apply(resolved);
    for (const listener of listeners) listener();
  };
  media.addEventListener("change", update);
  return {
    preference: () => preference,
    resolved: () => resolved,
    set: (next: AppearancePreference) => {
      preference = next;
      persist(next);
      update();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      media.removeEventListener("change", update);
      listeners.clear();
    },
  };
}

let controller: ReturnType<typeof createAppearanceController> | undefined;
let appliedRevision = -1;

/** Call before mounting any view. Production preferences only live in the active Rust profile. */
export function initializeAppearance(): void {
  if (controller || typeof window === "undefined") return;
  const query = new URLSearchParams(window.location.search);
  const preview = import.meta.env.DEV && query.has("preview");
  let initial: AppearancePreference = "system";
  if (preview) {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(PREVIEW_KEY);
    } catch {
      /* Storage may be disabled. */
    }
    const override = query.get("theme");
    initial = isAppearance(override) ? override : isAppearance(saved) ? saved : "system";
  }
  controller = createAppearanceController(
    window.matchMedia("(prefers-color-scheme: dark)"),
    initial,
    (resolved) => {
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    },
    (preference) => {
      if (!preview) return;
      try {
        window.localStorage.setItem(PREVIEW_KEY, preference);
      } catch {
        /* Keep the in-memory choice. */
      }
    },
  );
}

export function getAppearancePreference(): AppearancePreference {
  initializeAppearance();
  return controller?.preference() ?? "system";
}

export function setAppearancePreference(preference: AppearancePreference): void {
  initializeAppearance();
  controller?.set(preference);
}

/** Ignore a slower snapshot response from before the user's latest saved preference. */
export function applySetupAppearance(preferences: {
  readonly appearance: AppearancePreference;
  readonly revision: number;
}): void {
  if (preferences.revision < appliedRevision) return;
  appliedRevision = preferences.revision;
  setAppearancePreference(preferences.appearance);
}

export function subscribeAppearance(listener: () => void): () => void {
  initializeAppearance();
  return controller?.subscribe(listener) ?? (() => {});
}

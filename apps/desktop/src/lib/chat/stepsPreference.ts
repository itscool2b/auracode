import { useSyncExternalStore } from "react";

/**
 * Settings > Chats > Keep steps open: a finished turn shows its work (interim messages, tools,
 * thinking) instead of folding it under "Worked for" above its answer. Folded by default.
 */
let keepOpen = false;
let appliedRevision = -1;
const listeners = new Set<() => void>();

export function setKeepStepsOpen(value: boolean): void {
  if (keepOpen === value) return;
  keepOpen = value;
  for (const listener of listeners) listener();
}

export function getKeepStepsOpen(): boolean {
  return keepOpen;
}

/** Applies a setup snapshot's choice, ignoring a slower response from before a newer save. */
export function applyStepsPreference(preferences: {
  readonly revision: number;
  readonly general?: { readonly keep_steps_open?: boolean };
}): void {
  if (preferences.revision < appliedRevision) return;
  appliedRevision = preferences.revision;
  setKeepStepsOpen(preferences.general?.keep_steps_open === true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useKeepStepsOpen(): boolean {
  return useSyncExternalStore(subscribe, getKeepStepsOpen, getKeepStepsOpen);
}

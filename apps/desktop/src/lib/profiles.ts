import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppInfo, ProfileMeta } from "../bindings";
import { composerApi } from "./composer";
import { flushComposerDrafts } from "./composerDraft";
import { inTauri } from "./ipc";

export const profileApi = {
  list: () => invoke<ProfileMeta[]>("profiles_list"),
  activate: (profileId: string) => invoke<AppInfo>("profile_activate", { profileId }),
  activateAccount: () => invoke<AppInfo>("account_activate"),
};
export type ProfileApi = typeof profileApi;

/** Draft failures prevent native activation. A committed switch always discards the entire page. */
export async function performProfileSwitch(
  activate: () => Promise<unknown>,
  flush: () => Promise<boolean>,
  reload: () => void,
): Promise<void> {
  if (!(await flush()))
    throw new Error("Your draft has not been saved. Save it before switching profiles.");
  await activate();
  reload();
}

let switching = false;
let reloading = false;
const reload = () => {
  if (reloading) return;
  reloading = true;
  window.location.reload();
};

function setBusy(busy: boolean): void {
  const root = document.getElementById("root");
  if (root) root.inert = busy;
  document.getElementById("profile-transition")?.remove();
  if (busy) {
    const status = document.createElement("div");
    status.id = "profile-transition";
    status.className = "profile-transition orbit-theme";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Saving drafts and opening your profile…";
    document.body.append(status);
  }
}

/** Install before boot. Native publication also covers account-key restoration at startup. */
let eventReady: Promise<void> | null = null;
export function installProfileEvents(): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  eventReady ??= listen<AppInfo>("profile-changed", () => {
    setBusy(true);
    reload();
  })
    .then(() => {})
    .catch(() => {
      // Explicit activation still reloads from its successful response.
    });
  return eventReady;
}

export async function switchProfile(profileId?: string): Promise<void> {
  if (switching) throw new Error("A profile is already opening.");
  switching = true;
  setBusy(true);
  try {
    await performProfileSwitch(
      () => (profileId ? profileApi.activate(profileId) : profileApi.activateAccount()),
      () => flushComposerDrafts(composerApi),
      reload,
    );
  } catch (error) {
    switching = false;
    setBusy(false);
    throw error;
  }
}

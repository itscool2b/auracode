import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppInfo, ProfileMeta } from "../bindings";
import { composerApi } from "./composer";
import { flushComposerDrafts } from "./composerDraft";
import { inTauri } from "./ipc";

export const profileApi = {
  list: () => invoke<ProfileMeta[]>("profiles_list"),
  activate: (profileId: string) => invoke<AppInfo>("profile_activate", { profileId }),
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

const RETURN_KEY = "auracode.settings-return";

/**
 * A switch made in Settings reloads the page into another profile. Landing on that profile's
 * chats reads as Settings having closed by itself; so the page that asked for the switch asks to
 * be shown again, where the list says which profile is open now.
 */
export function takeSettingsReturn(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
): "privacy" | null {
  try {
    const page = storage?.getItem(RETURN_KEY);
    storage?.removeItem(RETURN_KEY);
    return page === "privacy" ? "privacy" : null;
  } catch {
    return null;
  }
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
    status.className = "profile-transition g-root";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Saving drafts and opening your profile…";
    document.body.append(status);
  }
}

/** Install before boot, so a switch the shell publishes is never missed. */
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

/** `returnTo`: the Settings page to open again once the other profile has loaded. */
export async function switchProfile(profileId: string, returnTo?: "privacy"): Promise<void> {
  if (switching) throw new Error("A profile is already opening.");
  switching = true;
  setBusy(true);
  try {
    await performProfileSwitch(
      () => profileApi.activate(profileId),
      () => flushComposerDrafts(composerApi),
      () => {
        try {
          if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo);
        } catch {
          // Without it the profile opens on its chats.
        }
        reload();
      },
    );
  } catch (error) {
    switching = false;
    setBusy(false);
    throw error;
  }
}

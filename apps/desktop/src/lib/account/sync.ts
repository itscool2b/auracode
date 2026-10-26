import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "../ipc";
import type { AccountSyncStatus } from "./bindings";

/** Native status only. An old profile cannot refresh the newly selected workspace. */
export function subscribeAccountSync(
  profileId: string | null,
  update: (status: AccountSyncStatus) => void,
): () => void {
  if (!profileId || !inTauri()) return () => {};
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void listen<[string, AccountSyncStatus]>("account-sync-changed", ({ payload }) => {
    if (!disposed && payload[0] === profileId) update(payload[1]);
  })
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {
      // Explicit refresh remains available if this window cannot register native events.
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

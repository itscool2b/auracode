import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "../ipc";
import type { AccountSyncStatus } from "./bindings";

/** Native status only. An old profile cannot refresh the newly selected workspace. */
export function subscribeAccountSync(
  profileId: string | null,
  update: (status: AccountSyncStatus) => void,
  ready?: () => void,
): () => void {
  if (!profileId || !inTauri()) {
    ready?.();
    return () => {};
  }
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void listen<[string, AccountSyncStatus]>("account-sync-changed", ({ payload }) => {
    if (!disposed && payload[0] === profileId) update(payload[1]);
  })
    .then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        ready?.();
      }
    })
    .catch(() => {
      // Explicit refresh remains available if this window cannot register native events.
      if (!disposed) ready?.();
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export interface AccountSyncSource {
  snapshot: () => Promise<[string, AccountSyncStatus] | null>;
  subscribe: typeof subscribeAccountSync;
}

export const accountSyncSource: AccountSyncSource = {
  snapshot: () => invoke("account_sync_status"),
  subscribe: subscribeAccountSync,
};

/** Subscribe before the cache read. A newer live event wins over an older in-flight snapshot. */
export function observeAccountSync(
  profileId: string,
  source: AccountSyncSource,
  update: (status: AccountSyncStatus | null) => void,
): () => void {
  let disposed = false;
  let received = false;
  const stop = source.subscribe(
    profileId,
    (status) => {
      if (disposed) return;
      received = true;
      update(status);
    },
    () => {
      if (disposed) return;
      void source.snapshot().then(
        (snapshot) => {
          if (!disposed && !received) update(snapshot?.[0] === profileId ? snapshot[1] : null);
        },
        () => {
          if (!disposed && !received) update(null);
        },
      );
    },
  );
  return () => {
    disposed = true;
    stop();
  };
}

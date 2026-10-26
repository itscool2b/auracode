import { invoke } from "@tauri-apps/api/core";
import { toCommandError } from "../ipc";
import type {
  ConfigSyncChoice,
  ConfigSyncInventory,
  ConfigSyncOutcome,
  ConfigSyncPreview,
  ConfigSyncReceipt,
} from "./bindings";

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}

export const configSyncApi = {
  inventory: (after: string | null) =>
    call<ConfigSyncInventory>("config_sync_inventory", { after }),
  preview: (id: string, choice: ConfigSyncChoice) =>
    call<ConfigSyncPreview>("config_sync_preview", { id, choice }),
  cancel: (token: string) => call<void>("config_sync_cancel", { token }),
  apply: (token: string) => call<ConfigSyncOutcome>("config_sync_apply", { token }),
  deviceOnly: (id: string, deviceOnly: boolean) =>
    call<void>("config_sync_device_only", { id, deviceOnly }),
  history: () => call<ConfigSyncReceipt[]>("config_sync_history"),
  rollback: (id: string) => call<ConfigSyncOutcome>("config_sync_rollback", { id }),
};
export type ConfigSyncApi = typeof configSyncApi;

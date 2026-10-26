import { invoke } from "@tauri-apps/api/core";
import { AccountCommandError } from "./api";
import type { AccountFailure, AccountVaultStatus } from "./bindings";

async function call(command: string, args?: Record<string, unknown>): Promise<AccountVaultStatus> {
  try {
    return await invoke<AccountVaultStatus>(command, args);
  } catch (failure) {
    if (failure && typeof failure === "object" && "code" in failure && "message" in failure)
      throw new AccountCommandError(failure as AccountFailure);
    throw new Error(
      "Secure storage could not complete that request. Your saved data was preserved.",
    );
  }
}
export const accountVaultApi = {
  status: () => call("account_vault_status"),
  unlock: (passphrase: string, create: boolean) =>
    call("account_vault_unlock", { passphrase, create }),
};
export type AccountVaultApi = typeof accountVaultApi;

import { invoke } from "@tauri-apps/api/core";
import { AccountCommandError } from "./api";
import type {
  AccountFailure,
  AccountRemovalCandidate,
  AccountRemovalReview,
  AccountStatus,
} from "./bindings";
export interface AccountRemovalApi {
  list(): Promise<AccountRemovalCandidate[]>;
  preview(profileId: string): Promise<AccountRemovalReview>;
  apply(token: string, confirmation: string): Promise<AccountStatus>;
  cancel(token: string): Promise<AccountStatus>;
}
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new AccountCommandError(error as AccountFailure);
  }
}
export const accountRemovalApi: AccountRemovalApi = {
  list: () => call("account_remove_candidates"),
  preview: (profileId) => call("account_remove_preview", { profileId }),
  apply: (token, confirmation) => call("account_remove_apply", { token, confirmation }),
  cancel: (token) => call("account_remove_cancel", { token }),
};

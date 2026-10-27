import { invoke } from "@tauri-apps/api/core";
import type { ProfileMeta } from "../../bindings";
import { profileApi } from "../profiles";
import { AccountCommandError } from "./api";
import type { AccountFailure, AccountStatus } from "./bindings";

export interface AccountRebindApi {
  list(): Promise<ProfileMeta[]>;
  restore(profileId: string): Promise<AccountStatus>;
}
export const accountRebindApi: AccountRebindApi = {
  list: profileApi.list,
  restore: async (profileId) => {
    try {
      return await invoke<AccountStatus>("account_rebind_profile", { profileId });
    } catch (error) {
      throw new AccountCommandError(error as AccountFailure);
    }
  },
};

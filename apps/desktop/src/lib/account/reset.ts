import { invoke } from "@tauri-apps/api/core";
import { AccountCommandError } from "./api";
import type {
  AccountFailure,
  AccountResetReview,
  AccountResetStatus,
  AccountStatus,
} from "./bindings";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (failure) {
    if (failure && typeof failure === "object" && "code" in failure && "message" in failure)
      throw new AccountCommandError(failure as AccountFailure);
    throw new Error(
      "The reset request could not finish. Its saved keys and local profiles were preserved.",
    );
  }
}
export const accountResetApi = {
  status: () => call<AccountResetStatus>("account_reset_status"),
  review: () => call<AccountResetReview>("account_reset_review"),
  confirm: (reviewId: string, confirmation: string, retained: boolean) =>
    call<AccountStatus>("account_reset_confirm", { reviewId, confirmation, retained }),
  retry: () => call<AccountStatus>("account_reset_retry"),
  cancel: () => call<AccountStatus>("account_reset_cancel"),
  dismiss: () => call<AccountStatus>("account_cancel_setup"),
};
export type AccountResetApi = typeof accountResetApi;

import { invoke } from "@tauri-apps/api/core";
import type {
  AccountConfiguration,
  AccountDevice,
  AccountFailure,
  AccountSignOut,
  AccountStatus,
  RecoverySetup,
  SignInChallenge,
} from "./bindings";

export class AccountCommandError extends Error {
  readonly retryAfter: number | null;
  constructor(failure: AccountFailure) {
    super(failure.message);
    this.name = "AccountCommandError";
    this.retryAfter = failure.retry_after_seconds;
  }
}

/** Native transport only. Rust owns the network, local vault and account state machine. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (failure) {
    if (failure && typeof failure === "object" && "code" in failure && "message" in failure)
      throw new AccountCommandError(failure as AccountFailure);
    throw new Error("The account service could not complete this request. Try again.");
  }
}

export const accountApi = {
  config: () => call<AccountConfiguration>("account_config"),
  status: () => call<AccountStatus>("account_status"),
  requestCode: (email: string, turnstileToken: string) =>
    call<SignInChallenge>("account_request_code", { email, turnstileToken }),
  verifyCode: (challengeId: string, code: string) =>
    call<AccountStatus>("account_verify_code", { challengeId, code }),
  refresh: () => call<AccountStatus>("account_refresh"),
  register: (name: string) => call<AccountStatus>("account_register_device", { name }),
  prepareRecovery: () => call<RecoverySetup>("account_prepare_recovery"),
  confirmRecovery: (setupId: string) =>
    call<AccountStatus>("account_confirm_recovery", { setupId, retained: true }),
  cancelSetup: () => call<AccountStatus>("account_cancel_setup"),
  recover: (recoveryKey: string) => call<AccountStatus>("account_recover", { recoveryKey }),
  confirmFingerprint: (fingerprint: string) =>
    call<AccountStatus>("account_confirm_fingerprint", { fingerprint }),
  devices: () => call<AccountDevice[]>("account_devices"),
  approve: (deviceId: string, verificationCode: string) =>
    call<AccountStatus>("account_approve_device", { deviceId, verificationCode }),
  revoke: (deviceId: string) => call<AccountStatus>("account_revoke_device", { deviceId }),
  signOut: () => call<AccountSignOut>("account_sign_out"),
};
export type AccountApi = typeof accountApi;

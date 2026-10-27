import { Check, Laptop, RefreshCw } from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { type AccountApi, AccountCommandError, accountApi } from "../../lib/account/api";
import type {
  AccountConfiguration,
  AccountDevice,
  AccountStatus,
  RecoverySetup,
  SignInChallenge,
} from "../../lib/account/bindings";
import { subscribeAccountSync } from "../../lib/account/sync";
import { type VerificationOrigin, verificationOrigin } from "../../lib/accountVerification";
import { errorMessage } from "../../lib/errors";
import { switchProfile } from "../../lib/profiles";
import { Modal } from "../chat/Modal";
import { AccountVault } from "./AccountVault";
import { AccountVerification } from "./AccountVerification";
import { KeepAsLocalPanel } from "./KeepAsLocalPanel";
import { RebindProfilePanel } from "./RebindProfilePanel";
import { RemoveAccountPanel } from "./RemoveAccountPanel";
import { ResetSyncPanel } from "./ResetSyncPanel";
import { SignOutDialog } from "./SignOutDialog";
import "./settings.css";
import "./account.css";

type Challenge = SignInChallenge & { expiresAt: number; resendAt: number };
type Recovery = RecoverySetup & { expiresAt: number };
type DeviceAction = { device: AccountDevice; kind: "approve" | "revoke" };
const time = (value: number | null) =>
  value === null ? "Not yet" : new Date(value).toLocaleString();

export function AccountPanel({
  api = accountApi,
  deviceName = "My computer",
  Verification = AccountVerification,
  activeProfileId = null,
  onActivate = switchProfile,
  recoveryOnly = false,
  recoveryProfileId = null,
  recoveryActionLabel = "Unlock selected account",
  initialEmail = "",
  subscribeSync = subscribeAccountSync,
}: {
  readonly api?: AccountApi;
  readonly deviceName?: string;
  readonly activeProfileId?: string | null;
  readonly onActivate?: () => Promise<void>;
  readonly recoveryOnly?: boolean;
  readonly recoveryProfileId?: string | null;
  readonly recoveryActionLabel?: string;
  readonly initialEmail?: string;
  readonly subscribeSync?: typeof subscribeAccountSync;
  readonly Verification?: ComponentType<{
    onToken: (token: string) => void;
    origin?: VerificationOrigin;
  }>;
}) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [config, setConfig] = useState<AccountConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signOutReview, setSignOutReview] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [email, setEmail] = useState(initialEmail);
  const [proof, setProof] = useState("");
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState(deviceName);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [retained, setRetained] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [compared, setCompared] = useState(false);
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceGeneration, setDeviceGeneration] = useState(0);
  const [deviceAction, setDeviceAction] = useState<DeviceAction | null>(null);
  const [deviceCode, setDeviceCode] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(false);
  const acting = useRef(false);
  const statusEpoch = useRef(0);
  useEffect(() => {
    let live = true;
    const stop = subscribeSync(activeProfileId, (sync) => {
      setStatus((current) =>
        current?.profile_id === activeProfileId ? { ...current, sync } : current,
      );
      if (sync.state !== "paused" || acting.current) return;
      const epoch = statusEpoch.current;
      // This is the native cached account state, not a cloud retry. A paused sync event can
      // arrive after the panel loaded Ready, so its access actions must follow that state too.
      void api.status().then(
        (fresh) => {
          if (!live || acting.current || epoch !== statusEpoch.current) return;
          setStatus((current) =>
            current?.profile_id === activeProfileId && current.account_id === fresh.account_id
              ? { ...fresh, sync: current.sync }
              : current,
          );
        },
        () => {},
      );
    });
    return () => {
      live = false;
      stop();
    };
  }, [api, activeProfileId, subscribeSync]);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      if (!recoveryOnly) void api.cancelSetup().catch(() => {});
    };
  }, [api, recoveryOnly]);
  useEffect(() => {
    void generation;
    let live = true;
    const epoch = ++statusEpoch.current;
    void Promise.all([api.config(), api.status()]).then(
      ([configuration, current]) => {
        if (!live || epoch !== statusEpoch.current) return;
        setConfig(configuration);
        setStatus(current);
        setError(null);
      },
      (failure) => {
        if (live && epoch === statusEpoch.current) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);
  useEffect(() => {
    void deviceGeneration;
    void status?.account_id;
    setDevices(null);
    setDeviceError(null);
    if (recoveryOnly || status?.access !== "ready") return;
    let live = true;
    void api.devices().then(
      (value) => {
        if (live) setDevices(value);
      },
      async (failure) => {
        if (!live) return;
        setDeviceError(errorMessage(failure));
        if (failure instanceof AccountCommandError && failure.code === "invite_required") {
          const epoch = statusEpoch.current;
          const fresh = await api.status().catch(() => null);
          if (!live || acting.current || epoch !== statusEpoch.current || !fresh) return;
          setStatus((current) =>
            current?.account_id === fresh.account_id ? { ...fresh, sync: current.sync } : current,
          );
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, status?.access, status?.account_id, deviceGeneration, recoveryOnly]);
  useEffect(() => {
    if (!recoveryOnly && recovery && recovery.expiresAt <= now) {
      setRecovery(null);
      setRetained(false);
      setNotice("That recovery setup expired. Create a new key to continue.");
      void api.cancelSetup().catch(() => {});
    }
  }, [api, now, recovery, recoveryOnly]);

  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    statusEpoch.current++;
    acting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure));
        if (failure instanceof AccountCommandError && failure.code === "invite_required") {
          setChallenge(null);
          setCode("");
          setProof("");
          setVerificationAttempt((value) => value + 1);
          const current = await api.status().catch(() => null);
          if (mounted.current && current) setStatus(current);
        }
        if (failure instanceof AccountCommandError && failure.retryAfter !== null)
          setRetryAt(Date.now() + Math.min(Math.max(failure.retryAfter, 0), 86400) * 1000);
      }
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (status?.access === "invite_required" && !busy) setDeviceAction(null);
  }, [status?.access, busy]);
  const update = async (operation: Promise<AccountStatus>) => {
    const value = await operation;
    if (mounted.current) {
      setStatus(value);
      setCompared(false);
    }
  };
  const origin = config ? verificationOrigin(config.service_origin) : null;
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const locked = busy || remaining > 0;
  const wrongRecoveryAccount =
    recoveryOnly &&
    (status?.access === "ready" ||
      status?.access === "deleted" ||
      status?.access === "invite_required") &&
    (!recoveryProfileId || status.profile_id !== recoveryProfileId);
  const signedOut =
    status &&
    (["signed_out", "expired", "denied"].includes(status.access) ||
      (recoveryOnly && (wrongRecoveryAccount || status.access === "needs_first_key")));
  const requestCode = () =>
    run(async () => {
      const token = proof;
      setProof("");
      try {
        const value = await api.requestCode(email.trim(), token);
        if (mounted.current) {
          setChallenge({
            ...value,
            expiresAt: Date.now() + value.expires_in * 1000,
            resendAt: Date.now() + value.resend_after * 1000,
          });
          setCode("");
        }
      } finally {
        if (mounted.current) setVerificationAttempt((value) => value + 1);
      }
    });
  const prepareRecovery = () =>
    run(async () => {
      const value = await api.prepareRecovery();
      if (mounted.current) {
        setRecovery({ ...value, expiresAt: Date.now() + 600_000 });
        setRetained(false);
      } else await api.cancelSetup();
    });
  const signOut = () =>
    run(async () => {
      const value = await api.signOut();
      if (!mounted.current) return;
      setSignOutReview(false);
      setStatus(value.status);
      setRecovery(null);
      setRecoveryInput("");
      setChallenge(null);
      setCode("");
      setEmail("");
      setDeviceAction(null);
      setNotice(
        value.server_revoked
          ? "Signed out. Your local data stays on this device."
          : "Signed out on this device. Remote sign-out could not be confirmed; reconnect to revoke that session.",
      );
    });

  return (
    <div className="account-panel" aria-busy={busy}>
      <section className="settings-section">
        <h2>{recoveryOnly ? "Unlock the account for this recovery" : "Your account"}</h2>
        <p className="account-description">
          {recoveryOnly
            ? "Sign in to the existing account that owns the saved configuration. Account and device changes stay unavailable until recovery finishes."
            : "Local is free and works offline. Cloud accounts, encrypted sync and transfers are invite-only during private preview."}
        </p>
        {!status && !error ? (
          <p role="status" className="settings-footnote">
            Reading account status…
          </p>
        ) : null}
        {signedOut ? (
          <div className="settings-group account-card">
            <h3>
              {status.access === "expired"
                ? "Sign in again"
                : status.access === "denied"
                  ? "This device needs access"
                  : "Sign in to auracode"}
            </h3>
            <p>
              Use the email address on your invitation. Your coding agents keep their own accounts;
              this sign-in is for your auracode workspace.
            </p>
            {challenge ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const entered = code;
                    setCode("");
                    await update(api.verifyCode(challenge.id, entered));
                    if (mounted.current) setChallenge(null);
                    await update(api.refresh());
                  });
                }}
              >
                <label className="settings-field">
                  Code sent to {email}
                  <input
                    className="g-input account-code-input"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    disabled={locked}
                    onChange={(event) =>
                      setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </label>
                <p className="settings-footnote">
                  {challenge.expiresAt <= now
                    ? "This code expired. Request a new one."
                    : `Code expires in ${Math.ceil((challenge.expiresAt - now) / 60000)} minutes.`}
                </p>
                <div className="account-actions">
                  <button
                    className="g-button g-button-primary"
                    disabled={locked || code.length !== 6 || challenge.expiresAt <= now}
                    type="submit"
                  >
                    Verify code
                  </button>
                  <button
                    className="g-button"
                    type="button"
                    disabled={locked || challenge.resendAt > now}
                    onClick={() => {
                      setChallenge(null);
                      setCode("");
                    }}
                  >
                    {challenge.resendAt > now
                      ? `New code in ${Math.ceil((challenge.resendAt - now) / 1000)}s`
                      : "Request another code"}
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestCode();
                }}
              >
                <label className="settings-field">
                  Email address
                  <input
                    className="g-input"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                    value={email}
                    disabled={locked}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                  />
                </label>
                {origin ? (
                  <Verification key={verificationAttempt} origin={origin} onToken={setProof} />
                ) : (
                  <p className="settings-error">Verification is unavailable for this build.</p>
                )}
                <button
                  className="g-button g-button-primary"
                  type="submit"
                  disabled={locked || !proof || !email.trim()}
                >
                  Send sign-in code
                </button>
              </form>
            )}
          </div>
        ) : null}
        {status?.access === "invite_required" ? (
          <div className="settings-group account-card">
            <h3>Cloud access requires an invitation</h3>
            <p>
              Cloud sync and transfers are paused. Your session and any saved encryption keys stay
              on this device. Local is free and works offline.
            </p>
            {status.local_key_available ? (
              <p>Your retained encrypted workspace remains available for local work and exports.</p>
            ) : null}
            <div className="account-actions">
              {status.local_key_available && status.profile_id !== activeProfileId ? (
                <button
                  className="g-button"
                  type="button"
                  disabled={locked || wrongRecoveryAccount}
                  onClick={() => void run(onActivate)}
                >
                  Open retained account workspace
                </button>
              ) : null}
              <button
                className="g-button"
                type="button"
                disabled={locked}
                onClick={() => void run(() => update(api.refresh()))}
              >
                Check cloud access
              </button>
            </div>
          </div>
        ) : null}
        {status?.access === "verification_required" ? (
          <div className="settings-group account-card">
            <h3>Finish checking your session</h3>
            <p>Your email code was accepted. Continue to check this device.</p>
            <button
              className="g-button"
              disabled={locked}
              onClick={() => void run(() => update(api.refresh()))}
              type="button"
            >
              Continue
            </button>
          </div>
        ) : null}
        {status?.access === "needs_device" ? (
          <form
            className="settings-group account-card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => update(api.register(name.trim())));
            }}
          >
            <h3>Name this device</h3>
            <p>You will see this name when approving access from another device.</p>
            <label className="settings-field">
              Device name
              <input
                className="g-input"
                required
                maxLength={80}
                value={name}
                disabled={locked}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <button
              className="g-button g-button-primary"
              type="submit"
              disabled={locked || !name.trim()}
            >
              Register this device
            </button>
          </form>
        ) : null}
        {status?.access === "needs_first_key" && !recoveryOnly ? (
          <div className="settings-group account-card">
            <h3>Keep a way back in</h3>
            <p>
              Your recovery key unlocks your account data if you lose access to every approved
              device. Save it somewhere private.
            </p>
            {recovery ? (
              <>
                <label className="settings-field">
                  Recovery key
                  <textarea
                    className="g-textarea account-secret"
                    readOnly
                    spellCheck={false}
                    autoComplete="off"
                    value={recovery.recovery_key}
                  />
                </label>
                <p className="settings-footnote">
                  This key is shown only during this setup. There is no account recovery without it
                  or an approved device.
                </p>
                <label className="account-check">
                  <input
                    type="checkbox"
                    checked={retained}
                    disabled={locked}
                    onChange={(event) => setRetained(event.currentTarget.checked)}
                  />
                  I saved my recovery key somewhere safe
                </label>
                <button
                  className="g-button g-button-primary"
                  type="button"
                  disabled={locked || !retained}
                  onClick={() =>
                    void run(async () => {
                      await update(api.confirmRecovery(recovery.id));
                      if (mounted.current) {
                        setRecovery(null);
                        setRetained(false);
                      }
                    })
                  }
                >
                  Confirm saved key
                </button>
              </>
            ) : (
              <button
                className="g-button g-button-primary"
                type="button"
                disabled={locked}
                onClick={() => void prepareRecovery()}
              >
                Create recovery key
              </button>
            )}
          </div>
        ) : null}
        {status?.access === "pending_approval" ? (
          <div className="settings-group account-card">
            <h3>Approve this device</h3>
            <p>
              On an approved device, open Settings, then Account. Select this device and enter the
              code below.
            </p>
            <code className="account-fingerprint">
              {status.approval_code ?? "Code unavailable. Refresh to try again."}
            </code>
            <button
              className="g-button"
              type="button"
              disabled={locked}
              onClick={() => void run(() => update(api.refresh()))}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Check approval
            </button>
            <details className="account-recovery">
              <summary>Use my recovery key instead</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const key = recoveryInput;
                  setRecoveryInput("");
                  void run(() => update(api.recover(key)));
                }}
              >
                <label className="settings-field">
                  Recovery key
                  <input
                    className="g-input account-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={recoveryInput}
                    disabled={locked}
                    onChange={(event) => setRecoveryInput(event.currentTarget.value)}
                  />
                </label>
                <button
                  className="g-button"
                  type="submit"
                  disabled={locked || !recoveryInput.trim()}
                >
                  Unlock with recovery key
                </button>
              </form>
            </details>
          </div>
        ) : null}
        {status?.access === "verify_account_key" ? (
          <div className="settings-group account-card">
            <h3>Compare your account fingerprint</h3>
            <p>
              Compare every group below with the fingerprint in Account on your trusted device.
              Continue only when they match.
            </p>
            <code className="account-fingerprint">{status.fingerprint}</code>
            <label className="account-check">
              <input
                type="checkbox"
                checked={compared}
                disabled={locked}
                onChange={(event) => setCompared(event.currentTarget.checked)}
              />
              I compared the complete fingerprint and it matches
            </label>
            <button
              className="g-button g-button-primary"
              type="button"
              disabled={locked || !compared || !status.fingerprint}
              onClick={() =>
                void run(() => update(api.confirmFingerprint(status.fingerprint ?? "")))
              }
            >
              Trust this account key
            </button>
          </div>
        ) : null}
        {status?.access === "ready" ? (
          <>
            <div className="settings-group account-card">
              <div className="account-heading">
                <Check size={16} aria-hidden="true" />
                <h3>This device is approved</h3>
              </div>
              <dl className="account-facts">
                <dt>Sync</dt>
                <dd>
                  {status.sync.state === "inactive" ? "Profile not active" : status.sync.state}
                </dd>
                <dt>Last synced</dt>
                <dd>{time(status.sync.last_sync_at)}</dd>
                {status.sync.pending_changes !== null ? (
                  <>
                    <dt>Waiting to sync</dt>
                    <dd>{status.sync.pending_changes}</dd>
                  </>
                ) : null}
              </dl>
              {status.sync.message ? <p role="status">{status.sync.message}</p> : null}
              {recoveryOnly && wrongRecoveryAccount ? (
                <p role="status">
                  This account does not match the saved recovery. Sign in to the owning account
                  above.
                </p>
              ) : null}
              {recoveryOnly || !status.profile_id || status.profile_id !== activeProfileId ? (
                <div className="account-actions">
                  <button
                    className="g-button g-button-primary"
                    type="button"
                    disabled={locked || wrongRecoveryAccount}
                    onClick={() => void run(onActivate)}
                  >
                    {recoveryOnly ? recoveryActionLabel : "Open account workspace"}
                  </button>
                </div>
              ) : null}
              <details>
                <summary>Account fingerprint</summary>
                <code className="account-fingerprint">{status.fingerprint}</code>
              </details>
            </div>
            {!recoveryOnly ? (
              <section className="settings-section">
                <div className="account-heading">
                  <h2>Devices</h2>
                  <button
                    className="g-button g-button-ghost g-button-28"
                    type="button"
                    disabled={locked}
                    onClick={() => setDeviceGeneration((value) => value + 1)}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Refresh devices
                  </button>
                </div>
                {!devices && !deviceError ? (
                  <p role="status" className="settings-footnote">
                    Loading devices…
                  </p>
                ) : null}
                {deviceError ? (
                  <p role="alert" className="settings-error">
                    {deviceError}
                  </p>
                ) : null}
                <ul className="account-devices">
                  {devices?.map((device) => (
                    <li key={device.id}>
                      <Laptop size={16} aria-hidden="true" />
                      <div>
                        <strong>
                          {device.name}
                          {device.current ? " · This device" : ""}
                        </strong>
                        <p>
                          {device.platform} ·{" "}
                          {device.revoked_at !== null
                            ? "Revoked"
                            : device.approved_at === null
                              ? "Waiting for approval"
                              : `Last seen ${time(device.last_seen)}`}
                        </p>
                      </div>
                      {device.revoked_at === null ? (
                        <button
                          className="g-button g-button-outline g-button-28"
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            setDeviceAction({
                              device,
                              kind: device.approved_at === null ? "approve" : "revoke",
                            });
                            setDeviceCode("");
                          }}
                        >
                          {device.approved_at === null ? "Review approval" : "Revoke"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        {status?.access === "deleted" ? (
          <div className="settings-group account-card">
            <h3>This account was deleted</h3>
            <p>Network sync has stopped. Its encrypted workspace stays on this computer.</p>
            {status.local_key_available ? (
              <>
                {!status.profile_id || status.profile_id !== activeProfileId || recoveryOnly ? (
                  <button
                    className="g-button"
                    type="button"
                    disabled={locked || wrongRecoveryAccount}
                    onClick={() => void run(onActivate)}
                  >
                    {recoveryOnly ? recoveryActionLabel : "Open retained account workspace"}
                  </button>
                ) : null}
                {!recoveryOnly && status.profile_id && status.profile_id === activeProfileId ? (
                  <KeepAsLocalPanel onOpen={(profileId) => switchProfile(profileId)} />
                ) : null}
              </>
            ) : (
              <p>The local account key is unavailable. Existing encrypted files were preserved.</p>
            )}
          </div>
        ) : null}
        {!recoveryOnly && status && !signedOut && status.access !== "deleted" ? (
          <button
            className="g-button"
            type="button"
            disabled={locked}
            onClick={() => {
              setError(null);
              setSignOutReview(true);
            }}
          >
            Sign out
          </button>
        ) : null}
      </section>
      {notice ? (
        <p className="account-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          {!status ? (
            <button
              className="g-button"
              type="button"
              onClick={() => setGeneration((value) => value + 1)}
            >
              Retry account status
            </button>
          ) : null}
        </div>
      ) : null}
      {remaining > 0 ? (
        <p role="status" className="settings-footnote">
          Try again in {remaining} seconds.
        </p>
      ) : null}
      <button
        className="g-button g-button-ghost account-vault-toggle"
        type="button"
        disabled={busy}
        onClick={() => setShowVault((value) => !value)}
      >
        {showVault ? "Close secure storage" : "Secure storage"}
      </button>
      {showVault ? <AccountVault onUnlocked={() => setGeneration((value) => value + 1)} /> : null}
      {status?.local_key_available && !status.profile_id ? (
        <RebindProfilePanel
          key={status.account_id}
          profileId={recoveryOnly ? recoveryProfileId : null}
          disabled={locked}
          onStatus={setStatus}
        />
      ) : null}
      {!recoveryOnly && status?.account_id && status.access !== "deleted" ? (
        <ResetSyncPanel
          key={status.account_id}
          access={status.access}
          allowReview={!status.local_key_available}
          disabled={locked}
          onStatus={(value) => setStatus(value)}
        />
      ) : null}
      {!recoveryOnly ? (
        <RemoveAccountPanel
          localActive={activeProfileId === "local"}
          disabled={locked}
          onLocal={() => switchProfile("local")}
          onStatus={setStatus}
        />
      ) : null}
      {!recoveryOnly && signOutReview ? (
        <SignOutDialog
          pending={status?.sync.pending_changes ?? null}
          busy={busy}
          error={error}
          onCancel={() => setSignOutReview(false)}
          onConfirm={() => void signOut()}
        />
      ) : null}
      {!recoveryOnly && deviceAction ? (
        <Modal
          title={deviceAction.kind === "approve" ? "Approve device" : "Revoke device"}
          closeDisabled={busy}
          onClose={() => setDeviceAction(null)}
          className="account-device-dialog"
        >
          <div className="account-card">
            <h3>{deviceAction.device.name}</h3>
            {deviceAction.kind === "approve" ? (
              <>
                <p>
                  Enter the verification code shown on that device. This gives it access to your
                  encrypted account data.
                </p>
                <label className="settings-field">
                  Recipient verification code
                  <input
                    className="g-input account-secret"
                    autoComplete="off"
                    spellCheck={false}
                    value={deviceCode}
                    maxLength={128}
                    disabled={locked}
                    onChange={(event) => setDeviceCode(event.currentTarget.value)}
                  />
                </label>
              </>
            ) : (
              <p>
                This device will lose sync access. Its existing local files stay on that device.
              </p>
            )}
            {error ? (
              <p role="alert" className="settings-error">
                {error}
              </p>
            ) : null}
            <div className="account-actions">
              <button
                className="g-button"
                type="button"
                disabled={busy}
                onClick={() => setDeviceAction(null)}
              >
                Cancel
              </button>
              <button
                className={
                  deviceAction.kind === "approve"
                    ? "g-button g-button-primary"
                    : "g-button g-button-danger"
                }
                type="button"
                disabled={locked || (deviceAction.kind === "approve" && !deviceCode.trim())}
                onClick={() =>
                  void run(async () => {
                    await update(
                      deviceAction.kind === "approve"
                        ? api.approve(deviceAction.device.id, deviceCode.trim())
                        : api.revoke(deviceAction.device.id),
                    );
                    if (mounted.current) {
                      setDeviceAction(null);
                      setDeviceCode("");
                      setDeviceGeneration((value) => value + 1);
                    }
                  })
                }
              >
                {deviceAction.kind === "approve"
                  ? "Approve reviewed device"
                  : "Revoke device access"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

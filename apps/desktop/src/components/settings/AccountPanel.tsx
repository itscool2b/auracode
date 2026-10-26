import { Check, KeyRound, Laptop, RefreshCw, ShieldCheck } from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { type AccountApi, AccountCommandError, accountApi } from "../../lib/account/api";
import type {
  AccountConfiguration,
  AccountDevice,
  AccountStatus,
  RecoverySetup,
  SignInChallenge,
} from "../../lib/account/bindings";
import { type VerificationOrigin, verificationOrigin } from "../../lib/accountVerification";
import { errorMessage } from "../../lib/errors";
import { switchProfile } from "../../lib/profiles";
import { Modal } from "../chat/Modal";
import { AccountVerification } from "./AccountVerification";
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
}: {
  readonly api?: AccountApi;
  readonly deviceName?: string;
  readonly activeProfileId?: string | null;
  readonly onActivate?: () => Promise<void>;
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
  const [generation, setGeneration] = useState(0);
  const [email, setEmail] = useState("");
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

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      void api.cancelSetup().catch(() => {});
    };
  }, [api]);
  useEffect(() => {
    void generation;
    let live = true;
    void Promise.all([api.config(), api.status()]).then(
      ([configuration, current]) => {
        if (!live) return;
        setConfig(configuration);
        setStatus(current);
        setError(null);
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
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
    if (status?.access !== "ready") return;
    let live = true;
    void api.devices().then(
      (value) => {
        if (live) setDevices(value);
      },
      (failure) => {
        if (live) setDeviceError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [api, status?.access, status?.account_id, deviceGeneration]);
  useEffect(() => {
    if (recovery && recovery.expiresAt <= now) {
      setRecovery(null);
      setRetained(false);
      setNotice("That recovery setup expired. Create a new key to continue.");
      void api.cancelSetup().catch(() => {});
    }
  }, [api, now, recovery]);

  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure));
        if (failure instanceof AccountCommandError && failure.retryAfter !== null)
          setRetryAt(Date.now() + Math.min(Math.max(failure.retryAfter, 0), 86400) * 1000);
      }
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
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
  const signedOut = status && ["signed_out", "expired", "denied"].includes(status.access);
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
        <div className="account-heading">
          <ShieldCheck size={20} />
          <h2>Your account</h2>
        </div>
        <p className="account-description">
          Keep working locally, or connect your own devices with encrypted sync.
        </p>
        {!status && !error ? <p role="status">Reading account status…</p> : null}
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
              Your coding agents keep their own accounts. This account is for your auracode
              workspace.
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
                <label className="ui-field">
                  Code sent to {email}
                  <input
                    className="ui-input account-code-input"
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
                    className="ui-button"
                    data-kind="primary"
                    disabled={locked || code.length !== 6 || challenge.expiresAt <= now}
                    type="submit"
                  >
                    Verify code
                  </button>
                  <button
                    className="ui-button"
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
                <label className="ui-field">
                  Email address
                  <input
                    className="ui-input"
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
                  className="ui-button"
                  data-kind="primary"
                  type="submit"
                  disabled={locked || !proof || !email.trim()}
                >
                  Send sign-in code
                </button>
              </form>
            )}
          </div>
        ) : null}
        {status?.access === "verification_required" ? (
          <div className="settings-group account-card">
            <h3>Finish checking your session</h3>
            <p>Your email code was accepted. Continue to check this device.</p>
            <button
              className="ui-button"
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
            <label className="ui-field">
              Device name
              <input
                className="ui-input"
                required
                maxLength={80}
                value={name}
                disabled={locked}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <button
              className="ui-button"
              type="submit"
              data-kind="primary"
              disabled={locked || !name.trim()}
            >
              Register this device
            </button>
          </form>
        ) : null}
        {status?.access === "needs_first_key" ? (
          <div className="settings-group account-card">
            <KeyRound size={22} />
            <h3>Keep a way back in</h3>
            <p>
              Your recovery key unlocks your account data if you lose access to every approved
              device. Save it somewhere private.
            </p>
            {recovery ? (
              <>
                <label className="ui-field">
                  Recovery key
                  <textarea
                    className="ui-input account-secret"
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
                  className="ui-button"
                  type="button"
                  data-kind="primary"
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
                className="ui-button"
                type="button"
                disabled={locked}
                data-kind="primary"
                onClick={() => void prepareRecovery()}
              >
                Create recovery key
              </button>
            )}
          </div>
        ) : null}
        {status?.access === "pending_approval" ? (
          <div className="settings-group account-card">
            <Laptop size={22} />
            <h3>Approve this device</h3>
            <p>
              On an approved device, open Settings, then Account. Select this device and enter the
              code below.
            </p>
            <code className="account-fingerprint">
              {status.approval_code ?? "Code unavailable. Refresh to try again."}
            </code>
            <button
              className="ui-button"
              type="button"
              disabled={locked}
              onClick={() => void run(() => update(api.refresh()))}
            >
              <RefreshCw size={14} />
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
                <label className="ui-field">
                  Recovery key
                  <input
                    className="ui-input account-secret"
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
                  className="ui-button"
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
              className="ui-button"
              data-kind="primary"
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
                <Check size={18} />
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
              {status.profile_id !== activeProfileId ? (
                <div className="account-actions">
                  <button
                    className="ui-button ui-button-primary"
                    type="button"
                    disabled={locked}
                    onClick={() => void run(onActivate)}
                  >
                    Open account workspace
                  </button>
                </div>
              ) : null}
              <details>
                <summary>Account fingerprint</summary>
                <code className="account-fingerprint">{status.fingerprint}</code>
              </details>
            </div>
            <section className="settings-section">
              <div className="account-heading">
                <h2>Devices</h2>
                <button
                  className="ui-button"
                  type="button"
                  disabled={locked}
                  onClick={() => setDeviceGeneration((value) => value + 1)}
                >
                  <RefreshCw size={13} />
                  Refresh devices
                </button>
              </div>
              {!devices && !deviceError ? <p role="status">Loading devices…</p> : null}
              {deviceError ? (
                <p role="alert" className="settings-error">
                  {deviceError}
                </p>
              ) : null}
              <ul className="account-devices">
                {devices?.map((device) => (
                  <li key={device.id}>
                    <Laptop size={18} />
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
                        className="ui-button"
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
          </>
        ) : null}
        {status && !signedOut ? (
          <button
            className="ui-button"
            type="button"
            disabled={locked}
            onClick={() => void signOut()}
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
              className="ui-button"
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
      {deviceAction ? (
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
                <label className="ui-field">
                  Recipient verification code
                  <input
                    className="ui-input account-secret"
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
                className="ui-button"
                type="button"
                disabled={busy}
                onClick={() => setDeviceAction(null)}
              >
                Cancel
              </button>
              <button
                className="ui-button"
                type="button"
                data-kind={deviceAction.kind === "approve" ? "primary" : "danger"}
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

import { StatusDot } from "@auracode/ui/graphite";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Account, ApiError, api, type Device, type SessionResponse } from "../api";
import { CodeForm } from "../code-form";
import { Arrow, formatBytes, Notice, Page } from "../ui";
export const meta = () => [
  { title: "Your account · auracode" },
  { name: "robots", content: "noindex" },
];
type Action = { kind: "device"; device: Device } | { kind: "logout" } | { kind: "delete" };
export default function AccountPage() {
  const [data, setData] = useState<{
    account: Account;
    devices: Device[];
    session: SessionResponse;
  } | null>(null);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailForm, setEmailForm] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const reload = useCallback(async () => {
    setError("");
    try {
      const [session, result, devices] = await Promise.all([
        api<SessionResponse>("/auth/session"),
        api<{ account: Account }>("/account"),
        api<{ devices: Device[] }>("/devices").then(
          (value) => ({ ...value, restricted: false, error: "" }),
          (error) => {
            if (error instanceof ApiError) {
              if (error.status === 401 || error.code === "account_deleted") throw error;
              if (error.status === 403 && error.code === "invite_required")
                return { devices: [] as Device[], restricted: true, error: "" };
            }
            // Device metadata is a cloud feature. Its outage must not hide authenticated
            // export/logout/deletion, which the API keeps available without invitation config.
            return { devices: [] as Device[], restricted: null, error: (error as Error).message };
          },
        ),
      ]);
      setData({ account: result.account, devices: devices.devices, session });
      setSignedOut(false);
      setDeleted(false);
      setInviteRequired((previous) => devices.restricted ?? previous);
      setDeviceError(devices.error);
      if (devices.restricted) setEmailForm(false);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === "account_deleted")) {
        setData(null);
        setSignedOut(true);
        setDeleted(error.code === "account_deleted");
      } else {
        if (error instanceof ApiError && error.code === "invite_required") {
          setInviteRequired(true);
          setAction(null);
          setEmailForm(false);
        }
        setError((error as Error).message);
      }
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (action) {
      setConfirmation("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [action]);
  async function mutate(path: string, method = "POST") {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(path, method, undefined, data.session.csrf_token);
      setAction(null);
      if (path.includes("logout") || path === "/account") {
        setData(null);
        setSignedOut(true);
        setDeleted(path === "/account");
      } else await reload();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === "account_deleted")) {
        setAction(null);
        setData(null);
        setSignedOut(true);
        setDeleted(error.code === "account_deleted");
      } else {
        if (error instanceof ApiError && error.code === "invite_required") {
          setInviteRequired(true);
          setAction(null);
          setEmailForm(false);
        }
        setError((error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }
  const fresh = !!data && Date.now() / 1000 - data.session.session.created_at <= 300;
  const destructive = action?.kind === "delete";
  return (
    <Page
      wide
      title="Your account."
      tone={data ? "Your workspace, connected." : "Devices, sync and export."}
    >
      {inviteRequired && data ? (
        <Notice>
          Cloud access is paused. Accounts, sync and transfers are invite-only during private
          preview. You can still export your encrypted archive or sign out below. Your Local app
          remains free and works offline.
        </Notice>
      ) : null}
      {error && (
        <Notice error>
          {error}{" "}
          <button type="button" className="text-button" onClick={() => void reload()}>
            Reload account
          </button>
        </Notice>
      )}
      {signedOut ? (
        <section className="account-signed-out">
          {deleted ? (
            <>
              <h2>This account was deleted.</h2>
              <p>
                Your retained local projects and chats stay on your devices. Open auracode to review
                a Local copy. Any new cloud account requires an invitation and starts fresh storage.
              </p>
              <div className="button-row">
                <a className="g-button g-button-primary g-button-44" href="auracode://signin">
                  Open auracode
                </a>
                <a className="g-button g-button-outline g-button-44" href="/download">
                  Download the app
                </a>
                <a className="text-link" href="/signin">
                  Invited sign-in
                </a>
              </div>
            </>
          ) : (
            <>
              <p>You’re signed out. Your local projects and chats remain on your devices.</p>
              <a className="g-button g-button-primary g-button-44" href="/signin">
                Sign in
              </a>
            </>
          )}
        </section>
      ) : !data ? (
        <p className="note" role="status">
          Loading your account…
        </p>
      ) : (
        <div className="account">
          <nav className="account-nav" aria-label="Account sections">
            <a href="#profile">Profile</a>
            <a href="#devices">Devices</a>
            <a href="#storage">Storage &amp; export</a>
            <a href="#security">Security</a>
            <button type="button" disabled={busy} onClick={() => void mutate("/auth/logout")}>
              Sign out ↗
            </button>
          </nav>
          <div className="account-blocks">
            <section id="profile" className="account-block" aria-labelledby="profile-title">
              <div className="account-block-head">
                <h2 id="profile-title">Profile</h2>
                <p>Your email is used for sign-in codes and account access.</p>
              </div>
              <div className="account-block-body">
                <h3 className="account-email">{data.account.email}</h3>
                {inviteRequired ? (
                  <p className="note">Email changes require cloud preview access.</p>
                ) : emailForm ? (
                  <div className="inline-form">
                    <CodeForm
                      mode="email"
                      csrf={data.session.csrf_token}
                      onSuccess={() => {
                        setEmailForm(false);
                        void reload();
                      }}
                    />
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setEmailForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : fresh ? (
                  <button
                    type="button"
                    className="g-button g-button-outline g-button-36"
                    onClick={() => setEmailForm(true)}
                  >
                    Change email
                  </button>
                ) : (
                  <a
                    className="text-link"
                    href={`/signin?email=${encodeURIComponent(data.account.email)}`}
                  >
                    Verify your email again to make changes <Arrow />
                  </a>
                )}
              </div>
            </section>
            <section id="devices" className="account-block" aria-labelledby="devices-title">
              <div className="account-block-head">
                <h2 id="devices-title">Devices</h2>
                <p>
                  Approve new devices in the desktop app. Revocation stops future cloud access; it
                  cannot erase data already downloaded.
                </p>
              </div>
              <div className="account-block-body">
                {deviceError ? (
                  <Notice error>
                    Device list unavailable. {deviceError}{" "}
                    <button type="button" className="text-button" onClick={() => void reload()}>
                      Retry devices
                    </button>
                  </Notice>
                ) : inviteRequired ? (
                  <p className="empty">Device management requires cloud preview access.</p>
                ) : data.devices.length === 0 ? (
                  <div className="empty">
                    <p>No devices connected yet.</p>
                    <a
                      className="text-link"
                      href={`auracode://signin?email=${encodeURIComponent(data.account.email)}`}
                    >
                      Connect this device in auracode <Arrow direction="up-right" />
                    </a>
                    <a className="text-link" href="/download">
                      Download the app
                    </a>
                  </div>
                ) : (
                  <ul className="device-list">
                    {data.devices.map((device) => (
                      <li key={device.id} className="device">
                        <div className="device-main">
                          <p className="device-name">{device.name}</p>
                          <p className="device-meta">
                            {device.platform === "macos" ? "macOS" : "Windows"} · Registered{" "}
                            {new Date(device.created_at * 1000).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="device-status">
                          <StatusDot
                            tone={device.revoked_at ? "red" : device.approved_at ? "green" : "volt"}
                          />
                          {device.revoked_at
                            ? "Revoked"
                            : device.approved_at
                              ? "Approved"
                              : "Awaiting approval"}
                        </span>
                        {!device.revoked_at && (
                          <button
                            type="button"
                            className="g-button g-button-outline g-button-28"
                            onClick={() => setAction({ kind: "device", device })}
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <section id="storage" className="account-block" aria-labelledby="storage-title">
              <div className="account-block-head">
                <h2 id="storage-title">Storage and export</h2>
                <p>
                  The service stores ciphertext. Your account keys stay on your approved devices.
                </p>
              </div>
              <div className="account-block-body">
                <div className="meters">
                  <div className="meter-block">
                    <span className="meter-label">Workspace history</span>
                    <span className="meter-value">
                      {formatBytes(data.account.sync_used_bytes)}{" "}
                      <small>/ {formatBytes(data.account.sync_limit_bytes)}</small>
                    </span>
                    <meter
                      min={0}
                      max={data.account.sync_limit_bytes}
                      value={data.account.sync_used_bytes}
                      aria-label="Workspace storage used"
                    />
                  </div>
                  <div className="meter-block">
                    <span className="meter-label">Encrypted files</span>
                    <span className="meter-value">
                      {formatBytes(data.account.blob_reserved_bytes)}{" "}
                      <small>/ {formatBytes(data.account.blob_limit_bytes)}</small>
                    </span>
                    <meter
                      min={0}
                      max={data.account.blob_limit_bytes}
                      value={data.account.blob_reserved_bytes}
                      aria-label="Encrypted file storage used"
                    />
                  </div>
                </div>
                <p className="note">
                  File storage includes previous versions awaiting cleanup. Pause syncing before
                  exporting for a stable copy.
                </p>
                <a
                  className="g-button g-button-outline g-button-36"
                  href="/api/v1/account/export"
                  download="auracode-encrypted-export.jsonl"
                >
                  Download encrypted archive <Arrow direction="down" />
                </a>
                <p className="note">
                  JSONL with encrypted records, files and key envelopes. Keep your recovery key
                  separately. Use the desktop for readable exports.
                </p>
              </div>
            </section>
            <section id="security" className="account-block" aria-labelledby="security-title">
              <div className="account-block-head">
                <h2 id="security-title">Security</h2>
                <p>End sessions or remove the cloud account. Local files are never touched.</p>
              </div>
              <div className="account-block-body">
                <div className="security-rows">
                  <div className="security-row">
                    <div>
                      <h3>Sign out everywhere</h3>
                      <p>End every web and desktop session. Device keys and local data are kept.</p>
                    </div>
                    <button
                      type="button"
                      className="g-button g-button-outline g-button-36"
                      onClick={() => setAction({ kind: "logout" })}
                    >
                      Sign out all
                    </button>
                  </div>
                  <div className="security-row">
                    <div>
                      <h3>Delete account</h3>
                      <p>
                        Revoke access now and schedule cloud data deletion. Local files remain on
                        your devices.
                      </p>
                    </div>
                    {fresh ? (
                      <button
                        type="button"
                        className="text-button text-button-danger"
                        onClick={() => setAction({ kind: "delete" })}
                      >
                        Delete account
                      </button>
                    ) : (
                      <a
                        className="text-link"
                        href={`/signin?email=${encodeURIComponent(data.account.email)}`}
                      >
                        Verify first <Arrow />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
      <dialog
        className="g-dialog confirm-dialog"
        ref={dialog}
        aria-labelledby="confirm-title"
        onCancel={() => setAction(null)}
        onClose={() => setAction(null)}
      >
        <h2 id="confirm-title">
          {action?.kind === "device"
            ? `Revoke ${action.device.name}?`
            : action?.kind === "logout"
              ? "Sign out everywhere?"
              : "Delete your account?"}
        </h2>
        <p>
          {action?.kind === "device"
            ? "This device will lose cloud access. Local files are kept."
            : action?.kind === "logout"
              ? "You will need a new email code to sign in again."
              : "This permanently removes your account and cloud data. Type your email to confirm."}
        </p>
        {action?.kind === "delete" && (
          <div className="confirm-field">
            <label htmlFor="confirm-email">{data?.account.email}</label>
            <input
              id="confirm-email"
              className="g-input field-input"
              type="email"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="confirm-actions">
          <button
            type="button"
            className="g-button g-button-36"
            onClick={() => setAction(null)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              destructive
                ? "g-button g-button-36 g-button-danger"
                : "g-button g-button-36 g-button-primary"
            }
            disabled={busy || (action?.kind === "delete" && confirmation !== data?.account.email)}
            onClick={() => {
              if (action?.kind === "device")
                void mutate(`/devices/${encodeURIComponent(action.device.id)}`, "DELETE");
              else if (action?.kind === "logout") void mutate("/auth/logout-all");
              else if (action?.kind === "delete") void mutate("/account", "DELETE");
            }}
          >
            {busy
              ? "Please wait…"
              : action?.kind === "device"
                ? "Revoke device"
                : action?.kind === "logout"
                  ? "Sign out all"
                  : "Delete account"}
          </button>
        </div>
      </dialog>
    </Page>
  );
}

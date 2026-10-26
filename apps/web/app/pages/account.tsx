import { useCallback, useEffect, useRef, useState } from "react";
import { type Account, ApiError, api, type Device, type SessionResponse } from "../api";
import { CodeForm } from "../code-form";
import { formatBytes, Notice, Page } from "../ui";
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
          (value) => ({ ...value, restricted: false }),
          (error) => {
            if (error instanceof ApiError && error.code === "invite_required")
              return { devices: [] as Device[], restricted: true };
            throw error;
          },
        ),
      ]);
      setData({ account: result.account, devices: devices.devices, session });
      setSignedOut(false);
      setDeleted(false);
      setInviteRequired(devices.restricted);
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
  return (
    <Page eyebrow="ACCOUNT" title={data ? "Your workspace, connected." : "Your account."}>
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
        <section className="prose">
          {deleted ? (
            <>
              <h2>This account was deleted.</h2>
              <p>
                Your retained local projects and chats stay on your devices. Open auracode to review
                a Local copy. Any new cloud account requires an invitation and starts fresh storage.
              </p>
              <div className="actions">
                <a className="button" href="auracode://signin">
                  Open auracode
                </a>
                <a className="button secondary" href="/download">
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
              <a className="button" href="/signin">
                Sign in
              </a>
            </>
          )}
        </section>
      ) : !data ? (
        <p role="status">Loading your account…</p>
      ) : (
        <div className="account-layout">
          <aside className="account-nav">
            <a href="#profile">Profile</a>
            <a href="#devices">Devices</a>
            <a href="#storage">Storage & export</a>
            <a href="#security">Security</a>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void mutate("/auth/logout")}
            >
              Sign out ↗
            </button>
          </aside>
          <div className="account-sections">
            <section id="profile">
              <p className="eyebrow">01 / PROFILE</p>
              <h2>{data.account.email}</h2>
              <p>Your email is used for sign-in codes and account access.</p>
              {inviteRequired ? (
                <p className="caption">Email changes require cloud preview access.</p>
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
                  <button className="text-button" type="button" onClick={() => setEmailForm(false)}>
                    Cancel
                  </button>
                </div>
              ) : fresh ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setEmailForm(true)}
                >
                  Change email
                </button>
              ) : (
                <a
                  className="text-link"
                  href={`/signin?email=${encodeURIComponent(data.account.email)}`}
                >
                  Verify your email again to make changes ↗
                </a>
              )}
            </section>
            <section id="devices">
              <p className="eyebrow">02 / DEVICES</p>
              <h2>Where your work lives.</h2>
              <p>
                Approve new devices in the desktop app. Revocation stops future cloud access; it
                cannot erase data already downloaded.
              </p>
              {inviteRequired ? (
                <p className="empty">Device management requires cloud preview access.</p>
              ) : data.devices.length === 0 ? (
                <div className="empty">
                  <p>No devices connected yet.</p>
                  <a
                    className="text-link"
                    href={`auracode://signin?email=${encodeURIComponent(data.account.email)}`}
                  >
                    Connect this device in auracode ↗
                  </a>
                  <a className="text-link" href="/download">
                    Download the app
                  </a>
                </div>
              ) : (
                <ul className="device-list">
                  {data.devices.map((device) => (
                    <li key={device.id}>
                      <span className="device-icon" aria-hidden="true">
                        ▤
                      </span>
                      <div>
                        <strong>{device.name}</strong>
                        <p>
                          {device.platform === "macos" ? "macOS" : "Windows"} · Registered{" "}
                          {new Date(device.created_at * 1000).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`status ${device.revoked_at ? "muted" : ""}`}>
                        {device.revoked_at
                          ? "Revoked"
                          : device.approved_at
                            ? "Approved"
                            : "Awaiting approval"}
                      </span>
                      {!device.revoked_at && (
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() => setAction({ kind: "device", device })}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section id="storage">
              <p className="eyebrow">03 / STORAGE</p>
              <h2>Encrypted before it leaves.</h2>
              <p>The service stores ciphertext. Your account keys stay on your approved devices.</p>
              <div className="storage">
                <div>
                  <span>Workspace history</span>
                  <strong>
                    {formatBytes(data.account.sync_used_bytes)}{" "}
                    <small>/ {formatBytes(data.account.sync_limit_bytes)}</small>
                  </strong>
                  <meter
                    min={0}
                    max={data.account.sync_limit_bytes}
                    value={data.account.sync_used_bytes}
                    aria-label="Workspace storage used"
                  />
                </div>
                <div>
                  <span>Encrypted files</span>
                  <strong>
                    {formatBytes(data.account.blob_reserved_bytes)}{" "}
                    <small>/ {formatBytes(data.account.blob_limit_bytes)}</small>
                  </strong>
                  <meter
                    min={0}
                    max={data.account.blob_limit_bytes}
                    value={data.account.blob_reserved_bytes}
                    aria-label="Encrypted file storage used"
                  />
                </div>
              </div>
              <p className="caption">
                File storage includes previous versions awaiting cleanup. Pause syncing before
                exporting for a stable copy.
              </p>
              <a
                className="button secondary"
                href="/api/v1/account/export"
                download="auracode-encrypted-export.jsonl"
              >
                Download encrypted archive ↓
              </a>
              <p className="caption">
                JSONL with encrypted records, files and key envelopes. Keep your recovery key
                separately. Use the desktop for readable exports.
              </p>
            </section>
            <section id="security">
              <p className="eyebrow">04 / SECURITY</p>
              <h2>Keep access in your hands.</h2>
              <div className="security-row">
                <div>
                  <h3>Sign out everywhere</h3>
                  <p>End every web and desktop session. Device keys and local data are kept.</p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setAction({ kind: "logout" })}
                >
                  Sign out all
                </button>
              </div>
              <div className="security-row">
                <div>
                  <h3>Delete account</h3>
                  <p>
                    Revoke access now and schedule cloud data deletion. Local files remain on your
                    devices.
                  </p>
                </div>
                {fresh ? (
                  <button
                    type="button"
                    className="button secondary danger"
                    onClick={() => setAction({ kind: "delete" })}
                  >
                    Delete account
                  </button>
                ) : (
                  <a
                    className="text-link"
                    href={`/signin?email=${encodeURIComponent(data.account.email)}`}
                  >
                    Verify first ↗
                  </a>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
      <dialog
        className="confirm-dialog"
        ref={dialog}
        onCancel={() => setAction(null)}
        onClose={() => setAction(null)}
      >
        <h2>
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
          <>
            <label htmlFor="confirm-email">{data?.account.email}</label>
            <input
              id="confirm-email"
              type="email"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setAction(null)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button destructive"
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

import { ArrowRight, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { subscribeAccountSync } from "../../lib/account/sync";
import { type ConfigSyncApi, configSyncApi } from "../../lib/config-sync/api";
import type {
  ConfigOperation,
  ConfigSyncChoice,
  ConfigSyncInventory,
  ConfigSyncItem,
  ConfigSyncOutcome,
  ConfigSyncPreview,
  ConfigSyncReceipt,
} from "../../lib/config-sync/bindings";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";
import "./settings.css";
import "./config-sync.css";

const OPERATIONS: Record<ConfigOperation, string> = {
  in_sync: "Up to date",
  apply: "Ready to download",
  publish: "Ready to share",
  merge: "Ready to merge",
  conflict: "Needs a decision",
  wait: "Waiting",
};
const PROVIDERS = { claude: "Claude", codex: "Codex", pi: "Pi", shared: "Shared" };
const SCOPES = { portable: "All devices", macos: "macOS", windows: "Windows" } as const;

/**
 * Configuration sync as one list (Vercel's project list): each agent file with where it applies,
 * where it stands, a switch to keep it on this device and Review. Every change is reviewed in a
 * dialog first; History holds what was applied here, each with its own reviewed restore.
 */
export function ConfigSyncPanel({
  active,
  profileId = null,
  onAccount,
  api = configSyncApi,
}: {
  readonly active: boolean;
  readonly profileId?: string | null;
  readonly onAccount: () => void;
  readonly api?: ConfigSyncApi;
}) {
  const [inventory, setInventory] = useState<ConfigSyncInventory | null>(null);
  const [history, setHistory] = useState<ConfigSyncReceipt[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selected, setSelected] = useState<ConfigSyncItem | null>(null);
  const [restore, setRestore] = useState<ConfigSyncReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConfigSyncOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const lock = useRef(false);
  const alive = useRef(false);
  const refresh = () => setVersion((value) => value + 1);
  useEffect(
    () =>
      subscribeAccountSync(active ? profileId : null, (status) => {
        if (status.state === "idle" && status.last_sync_at !== null)
          setVersion((value) => value + 1);
      }),
    [active, profileId],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an explicit refresh.
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    setError(null);
    setInventory(null);
    setHistory([]);
    void Promise.allSettled([api.inventory(null), api.history()]).then(([items, receipts]) => {
      if (!live) return;
      if (items.status === "fulfilled") setInventory(items.value);
      else setError(errorMessage(items.reason));
      if (receipts.status === "fulfilled") setHistory(receipts.value);
      else setError(`Recovery history could not be read. ${errorMessage(receipts.reason)}`);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [active, api, version]);
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const completed = (result: ConfigSyncOutcome) => {
    if (!alive.current) return;
    setStatus(result);
    setSelected(null);
    setRestore(null);
    refresh();
  };
  if (!active)
    return (
      <section className="settings-section config-sync-empty">
        <h2>Sync your setup across devices</h2>
        <p>
          Instructions, skills and settings can follow you once you sign in with an invited email.
          Cloud sync is invite-only for now; without it, everything stays on this computer.
        </p>
        <button type="button" className="g-button g-button-outline" onClick={onAccount}>
          Open Account settings <ArrowRight size={14} aria-hidden="true" />
        </button>
      </section>
    );
  const attention = history.some((receipt) => receipt.status === "recovery_required");
  return (
    <section className="settings-section config-sync" aria-label="Configuration sync">
      <div className="config-sync-toolbar">
        <p>Choose what syncs. Conflicts wait for your review, and credentials stay here.</p>
        <fieldset className="g-segmented g-segmented-quiet config-sync-views">
          <legend className="sr-only">Show</legend>
          <button
            type="button"
            className="g-segment"
            aria-pressed={!showHistory}
            onClick={() => setShowHistory(false)}
          >
            Items
          </button>
          <button
            type="button"
            className="g-segment"
            aria-pressed={showHistory}
            onClick={() => setShowHistory(true)}
          >
            History
            {attention ? <span className="config-sync-attention" aria-hidden="true" /> : null}
          </button>
        </fieldset>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon"
          aria-label="Refresh configuration"
          title="Refresh"
          disabled={loading || busy}
          onClick={refresh}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      {status ? (
        <p className={status.completed ? "config-sync-status" : "settings-error"} role="status">
          {status.message}
        </p>
      ) : null}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="settings-footnote">
          Reading your configuration…
        </p>
      ) : null}
      {inventory?.notices.length ? (
        <details className="config-sync-notices">
          <summary>
            {inventory.notices.length === 1
              ? "1 item needs attention"
              : `${inventory.notices.length} items need attention`}
          </summary>
          <ul>
            {[...new Set(inventory.notices)].map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {showHistory ? (
        <div className="settings-group config-sync-list">
          {!history.length && !loading ? (
            <div className="config-sync-none">
              <strong>No changes yet</strong>
              <p>Changes applied on this device appear here.</p>
            </div>
          ) : null}
          {history.map((receipt) => (
            <div className="config-sync-row" key={receipt.id}>
              <div className="config-sync-name">
                <strong>{receipt.label}</strong>
                <p>{PROVIDERS[receipt.provider]}</p>
              </div>
              <span
                className="config-sync-state"
                data-attention={receipt.status === "recovery_required" || undefined}
              >
                {receipt.status === "recovery_required"
                  ? "Needs recovery"
                  : receipt.status === "rolled_back"
                    ? "Restored"
                    : "Applied"}
              </span>
              <div className="config-sync-actions">
                {receipt.status !== "rolled_back" ? (
                  <button
                    type="button"
                    className="g-button g-button-outline g-button-28"
                    disabled={busy}
                    onClick={() => setRestore(receipt)}
                  >
                    {receipt.status === "recovery_required" ? "Review recovery" : "Review restore"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="settings-group config-sync-list">
          {!inventory?.items.length && !loading && !error ? (
            <div className="config-sync-none">
              <strong>Nothing to sync yet</strong>
              <p>Add instructions, skills or settings through an installed agent, then refresh.</p>
            </div>
          ) : null}
          {inventory?.items.map((item) => (
            <div className="config-sync-row" key={item.id}>
              <div className="config-sync-name">
                <strong>{item.label}</strong>
                <p>
                  {item.provider ? `${PROVIDERS[item.provider]} · ` : ""}
                  {item.scope ? SCOPES[item.scope] : "Awaiting details"}
                </p>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <span
                className="config-sync-state"
                data-attention={item.operation === "conflict" || item.skipped || undefined}
                data-quiet={item.device_only || item.operation === "in_sync" || undefined}
              >
                {item.device_only
                  ? "Only on this device"
                  : item.skipped
                    ? "Previous change needs review"
                    : OPERATIONS[item.operation]}
                {item.first_link ? <small>First connection</small> : null}
              </span>
              <div className="config-sync-actions">
                <label className="config-sync-local">
                  <input
                    type="checkbox"
                    className="g-switch"
                    checked={item.device_only}
                    disabled={busy || loading}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      void action(async () => {
                        await api.deviceOnly(item.id, checked);
                        if (alive.current) refresh();
                      });
                    }}
                  />
                  Keep on this device
                </label>
                <button
                  type="button"
                  className="g-button g-button-outline g-button-28"
                  disabled={busy || loading}
                  onClick={() => setSelected(item)}
                >
                  Review
                </button>
              </div>
            </div>
          ))}
          {inventory?.next_cursor ? (
            <button
              type="button"
              className="config-sync-more"
              disabled={busy || loading}
              onClick={() =>
                void action(async () => {
                  const page = await api.inventory(inventory.next_cursor);
                  if (alive.current)
                    setInventory((current) =>
                      current
                        ? {
                            ...page,
                            items: [
                              ...current.items,
                              ...page.items.filter(
                                (item) =>
                                  !current.items.some((existing) => existing.id === item.id),
                              ),
                            ],
                            notices: [...new Set([...current.notices, ...page.notices])],
                          }
                        : page,
                    );
                })
              }
            >
              Load more
            </button>
          ) : null}
        </div>
      )}
      {selected ? (
        <ConfigReview
          key={selected.id}
          item={selected}
          api={api}
          onClose={() => setSelected(null)}
          onComplete={completed}
        />
      ) : null}
      {restore ? (
        <Modal
          title={
            restore.status === "recovery_required"
              ? "Recover configuration"
              : "Restore local configuration"
          }
          size="md"
          className="config-sync-dialog"
          onClose={() => setRestore(null)}
          closeDisabled={busy}
        >
          <p className="config-sync-lead">
            Restores <strong>{restore.label}</strong> to how it was before this change. Other
            settings stay in place, and later edits to the same item can stop the restore.
          </p>
          <dl className="config-sync-facts">
            <dt>Agent</dt>
            <dd>{PROVIDERS[restore.provider]}</dd>
            <dt>Afterwards</dt>
            <dd>Review the item again to choose what your other devices get.</dd>
          </dl>
          {error ? (
            <p role="alert" className="config-sync-error">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions config-sync-footer">
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => setRestore(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={() => void action(async () => completed(await api.rollback(restore.id)))}
            >
              {busy ? "Restoring…" : "Restore this item"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ConfigReview({
  item,
  api,
  onClose,
  onComplete,
}: {
  readonly item: ConfigSyncItem;
  readonly api: ConfigSyncApi;
  readonly onClose: () => void;
  readonly onComplete: (outcome: ConfigSyncOutcome) => void;
}) {
  const [choice, setChoice] = useState<ConfigSyncChoice>("automatic");
  const [preview, setPreview] = useState<ConfigSyncPreview | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const consuming = useRef(false);
  const token = useRef<string | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version requests a new one-use review.
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    setConfirmDelete(false);
    api.preview(item.id, choice).then(
      (result) => {
        if (!live) {
          void api.cancel(result.token).catch(() => {});
          return;
        }
        token.current = result.token;
        setPreview(result);
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
      const current = token.current;
      token.current = null;
      if (current) void api.cancel(current).catch(() => {});
    };
  }, [api, item.id, choice, version]);
  const apply = async () => {
    if (
      consuming.current ||
      !preview?.can_apply ||
      !token.current ||
      (preview.deletes_item && !confirmDelete)
    )
      return;
    consuming.current = true;
    setBusy(true);
    setError(null);
    const reviewed = token.current;
    token.current = null;
    try {
      const outcome = await api.apply(reviewed);
      if (alive.current) onComplete(outcome);
    } catch (failure) {
      if (alive.current) {
        setPreview(null);
        setError(errorMessage(failure));
      }
    } finally {
      consuming.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      title="Review configuration"
      size="lg"
      onClose={onClose}
      closeDisabled={busy}
      className="config-sync-dialog config-sync-review"
    >
      <p className="config-sync-lead">
        <strong>{item.label}</strong>
        {item.provider ? ` from ${PROVIDERS[item.provider]}` : ""}. Choose how this device and your
        account meet.
      </p>
      <fieldset className="g-segmented config-sync-choices">
        <legend className="sr-only">How to resolve this item</legend>
        {(
          [
            ["automatic", "Merge safely"],
            ["keep_local", "Keep this device"],
            ["use_remote", "Use account version"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className="g-segment"
            aria-pressed={choice === value}
            disabled={busy}
            onClick={() => setChoice(value)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {error ? (
        <div className="config-sync-failed" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="g-button g-button-28"
            disabled={busy}
            onClick={() => setVersion((value) => value + 1)}
          >
            Review again
          </button>
        </div>
      ) : !preview ? (
        <p role="status" className="config-sync-preparing">
          Preparing your review…
        </p>
      ) : null}
      {preview ? (
        <>
          {preview.conflicts.length ? (
            <p className="config-sync-warning">
              Both versions changed: {preview.conflicts.join(", ")}. Choose which one to keep.
            </p>
          ) : null}
          <div className="config-sync-comparison">
            {(
              [
                ["Last synchronized", preview.base],
                ["This device", preview.local],
                ["Account", preview.remote],
                ["Result", preview.result],
              ] as const
            ).map(([title, value]) => (
              <section key={title} data-result={title === "Result" || undefined}>
                <h3>{title}</h3>
                <pre>{value ?? "No item"}</pre>
              </section>
            ))}
          </div>
          {preview.warnings.length ? (
            <ul className="config-sync-warnings">
              {[...new Set(preview.warnings)].map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {preview.deletes_item ? (
            <label className="config-sync-delete">
              <input
                type="checkbox"
                checked={confirmDelete}
                disabled={busy}
                onChange={(event) => setConfirmDelete(event.target.checked)}
              />
              I reviewed the removal of this item.
            </label>
          ) : null}
          <div className="g-dialog-actions config-sync-footer">
            <span>{OPERATIONS[preview.item.operation]}</span>
            <button type="button" className="g-button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={
                preview.deletes_item ? "g-button g-button-danger" : "g-button g-button-primary"
              }
              disabled={busy || !preview.can_apply || (preview.deletes_item && !confirmDelete)}
              onClick={() => void apply()}
            >
              {busy
                ? "Applying…"
                : preview.deletes_item
                  ? "Apply reviewed removal"
                  : "Apply reviewed change"}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

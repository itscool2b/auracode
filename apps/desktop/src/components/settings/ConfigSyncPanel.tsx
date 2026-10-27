import { ArrowRight, History, RefreshCw } from "lucide-react";
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
        <h2>Your setup, on every device</h2>
        <p>
          Configuration sync is part of the invite-only cloud preview. Sign in with your invited
          email and open your Account workspace to review agent instructions, skills and settings.
          Local use is free and stays on this computer.
        </p>
        <button type="button" className="g-button g-button-outline" onClick={onAccount}>
          Open Account settings <ArrowRight size={14} aria-hidden="true" />
        </button>
      </section>
    );
  return (
    <section className="settings-section config-sync" aria-label="Configuration sync">
      <div className="config-sync-toolbar">
        <p>
          Choose what to sync once. Selected items stay in sync automatically; conflicts need your
          review. Cloud sync requires preview access. Credentials stay on each device.
        </p>
        <button
          type="button"
          className="g-button g-button-outline g-button-28 config-sync-toggle"
          aria-pressed={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          <History size={14} aria-hidden="true" />
          History
        </button>
        <button
          type="button"
          className="g-button g-button-ghost g-button-28"
          disabled={loading || busy}
          onClick={refresh}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
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
          <summary>Some configuration needs attention ({inventory.notices.length})</summary>
          <ul>
            {[...new Set(inventory.notices)].map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {showHistory ? (
        <div className="settings-group">
          <h2 className="config-sync-list-heading">Local change history</h2>
          {!history.length && !loading ? (
            <p className="config-sync-empty">
              No configuration changes have been applied on this device.
            </p>
          ) : null}
          {history.map((receipt) => (
            <div className="config-sync-row" key={receipt.id}>
              <div>
                <strong>{receipt.label}</strong>
                <p>
                  {PROVIDERS[receipt.provider]} ·{" "}
                  {receipt.status === "recovery_required"
                    ? "Recovery required"
                    : receipt.status === "rolled_back"
                      ? "Restored"
                      : "Applied"}
                </p>
              </div>
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
          ))}
        </div>
      ) : (
        <div className="settings-group">
          <h2 className="config-sync-list-heading">Agent configuration</h2>
          {!inventory?.items.length && !loading && !error ? (
            <p className="config-sync-empty">
              No supported configuration to sync yet. Add instructions, skills or settings through
              an installed agent, then refresh.
            </p>
          ) : null}
          {inventory?.items.map((item) => (
            <div className="config-sync-row" key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <p>
                  {item.provider ? `${PROVIDERS[item.provider]} · ` : ""}
                  {item.scope === "portable"
                    ? "All devices"
                    : item.scope === "macos"
                      ? "macOS"
                      : item.scope === "windows"
                        ? "Windows"
                        : "Awaiting details"}
                </p>
                <span
                  className="config-sync-state"
                  data-attention={item.operation === "conflict" || item.skipped}
                >
                  {item.device_only
                    ? "Only on this device"
                    : item.skipped
                      ? "Previous change needs review"
                      : OPERATIONS[item.operation]}
                  {item.first_link ? " · First connection" : ""}
                </span>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <div className="config-sync-actions">
                <label>
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
                  Review <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {inventory?.next_cursor ? (
            <button
              type="button"
              className="g-button config-sync-more"
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
          onClose={() => setRestore(null)}
          closeDisabled={busy}
        >
          <div className="config-sync-restore">
            <p>
              Restore <strong>{restore.label}</strong> to its state before this change. Later edits
              to the same item may prevent restoration. Other settings stay in place.
            </p>
            <p>
              After restoring, review the item again to decide what to share with your other
              devices.
            </p>
            {error ? (
              <p role="alert" className="settings-error">
                {error}
              </p>
            ) : null}
            <div className="config-sync-footer">
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
      onClose={onClose}
      closeDisabled={busy}
      className="config-sync-review"
    >
      <div className="config-sync-review-body">
        <div className="config-sync-review-heading">
          <strong>{item.label}</strong>
          <p>{item.provider ? PROVIDERS[item.provider] : "Agent configuration"}</p>
        </div>
        <fieldset className="g-segmented config-sync-choices">
          <legend className="settings-sr-only">How to resolve this item</legend>
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
          <div className="settings-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => setVersion((value) => value + 1)}
            >
              Review again
            </button>
          </div>
        ) : !preview ? (
          <p role="status" className="settings-footnote">
            Preparing your review…
          </p>
        ) : null}
        {preview ? (
          <>
            {preview.warnings.length ? (
              <ul className="config-sync-warnings">
                {[...new Set(preview.warnings)].map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {preview.conflicts.length ? (
              <p className="config-sync-warning">
                Both versions changed: {preview.conflicts.join(", ")}. Choose which version to keep.
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
                <section key={title}>
                  <h3>{title}</h3>
                  <pre>{value ?? "No item"}</pre>
                </section>
              ))}
            </div>
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
            <div className="config-sync-footer">
              <span>{OPERATIONS[preview.item.operation]}</span>
              <button type="button" className="g-button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="g-button g-button-primary"
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
      </div>
    </Modal>
  );
}

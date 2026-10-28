import { ArrowRight, History, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { subscribeAccountSync } from "../../lib/account/sync";
import { type ConfigSyncApi, configSyncApi } from "../../lib/config-sync/api";
import type {
  ConfigHold,
  ConfigOperation,
  ConfigSyncChoice,
  ConfigSyncInventory,
  ConfigSyncItem,
  ConfigSyncOutcome,
  ConfigSyncPreview,
  ConfigSyncReceipt,
} from "../../lib/config-sync/bindings";
import type { VendorApi } from "../../lib/config-vendor/api";
import type { VendorProvider } from "../../lib/config-vendor/bindings";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";
import { VendorDialog } from "../library/VendorDialog";
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
const PROVIDERS = { claude: "Claude Code", codex: "Codex", pi: "Pi", shared: "Shared skills" };
const ORDER = ["claude", "codex", "pi", "shared"] as const;
type Provider = (typeof ORDER)[number];

/** Items by agent, in the Plugin library's order; an item still downloading joins its agent. */
export function groups(items: readonly ConfigSyncItem[]): [Provider, ConfigSyncItem[]][] {
  return ORDER.map(
    (provider) =>
      [provider, items.filter((item) => (item.provider ?? "shared") === provider)] as [
        Provider,
        ConfigSyncItem[],
      ],
  ).filter(([, entries]) => entries.length > 0);
}

/** Ready for "Apply all": nothing to decide and nothing held. */
const ready = (item: ConfigSyncItem) =>
  !item.hold &&
  !item.device_only &&
  !item.skipped &&
  (item.operation === "apply" || item.operation === "publish" || item.operation === "merge");

/**
 * One agent's items under its name, with its sync switch for this device and Apply all for what
 * is ready. Each held item says why in one line.
 */
export function AgentGroup({
  provider,
  items,
  paused,
  busy,
  onSync,
  onApplyAll,
  onDeviceOnly,
  onReview,
}: {
  readonly provider: Provider;
  readonly items: readonly ConfigSyncItem[];
  readonly paused: boolean;
  readonly busy: boolean;
  readonly onSync: (enabled: boolean) => void;
  readonly onApplyAll: () => void;
  readonly onDeviceOnly: (item: ConfigSyncItem, checked: boolean) => void;
  readonly onReview: (item: ConfigSyncItem) => void;
}) {
  const name = PROVIDERS[provider];
  const readyCount = items.filter(ready).length;
  const headingId = `config-sync-${provider}`;
  return (
    <section className="config-sync-agent" aria-labelledby={headingId}>
      <div className="settings-row config-sync-agent-head">
        <div className="settings-row-text">
          <div>
            <strong id={headingId} className="config-sync-name">
              {name}
            </strong>
            <p>
              {items.length} {items.length === 1 ? "item" : "items"}
              {readyCount ? ` · ${readyCount} ready` : ""}
              {paused ? " · Sync is off on this device" : ""}
            </p>
          </div>
        </div>
        {readyCount ? (
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            disabled={busy}
            onClick={onApplyAll}
          >
            Apply all {readyCount}
          </button>
        ) : null}
        {provider !== "shared" ? (
          <input
            type="checkbox"
            role="switch"
            className="g-switch"
            aria-label={`Sync ${name} on this device`}
            aria-checked={!paused}
            checked={!paused}
            disabled={busy}
            onChange={(event) => onSync(event.currentTarget.checked)}
          />
        ) : null}
      </div>
      {items.map((item) => (
        <div className="settings-row" key={item.id}>
          <div className="settings-row-text">
            <div>
              <strong className="config-sync-name">{item.label}</strong>
              <p>
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
                data-attention={item.operation === "conflict" || item.skipped || undefined}
              >
                {item.device_only
                  ? "Only on this device"
                  : item.removed_upstream
                    ? "Removed on another device"
                    : item.hold
                      ? HOLDS[item.hold.kind]
                      : item.skipped
                        ? "Previous change needs review"
                        : OPERATIONS[item.operation]}
                {item.first_link ? " · First connection" : ""}
              </span>
              {item.detail ? <p>{item.detail}</p> : null}
              <label className="config-sync-local">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={item.device_only}
                  className="g-switch"
                  checked={item.device_only}
                  disabled={busy}
                  onChange={(event) => onDeviceOnly(item, event.target.checked)}
                />
                Keep on this device
              </label>
            </div>
          </div>
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            aria-label={`Review ${item.label}`}
            disabled={busy}
            onClick={() => onReview(item)}
          >
            Review <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </section>
  );
}

const HOLDS: Record<ConfigHold["kind"], string> = {
  agent_missing: "Waiting for the agent",
  sync_paused: "Sync is off",
  needs_version: "Needs a newer agent",
  marketplace_missing: "Marketplace not added",
  vendor_install: "Install with the agent",
  device_specific: "Another system only",
  missing_path: "Command not on this device",
  foreign_path: "Kept on its own device",
  retained: "Previous change needs review",
  offline: "Offline",
};

/**
 * Configuration sync as settings rows in one well (X Money's groups): each agent file with where it
 * applies, where it stands, a switch to keep it on this device and Review. Every change is reviewed
 * in a dialog first (one sentence, the choice, four versions, Cancel and one action); History holds
 * what was applied here, each with its own reviewed restore.
 */
export function ConfigSyncPanel({
  active,
  profileId = null,
  onAccount,
  api = configSyncApi,
  vendorApi,
}: {
  readonly active: boolean;
  readonly profileId?: string | null;
  readonly onAccount: () => void;
  readonly api?: ConfigSyncApi;
  /** The reviewed installer terminal for plugin steps; the native one by default. */
  readonly vendorApi?: VendorApi;
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
      // Vercel's empty state: one title, one line, and the one way forward.
      <section className="settings-section" aria-labelledby="config-sync-empty-title">
        <div className="settings-group config-sync-blank">
          <h2 id="config-sync-empty-title">Your setup, on every device</h2>
          <p>
            Sign in with your invited email and open your Account workspace to sync agent
            instructions, skills and settings.
          </p>
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            onClick={onAccount}
          >
            Open Account settings <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  return (
    <section className="settings-section config-sync" aria-label="Configuration sync">
      <p className="settings-lead">
        Choose what syncs once and it stays in sync; conflicts wait for your review. Credentials
        stay on each device.
      </p>
      <div className="settings-heading config-sync-heading">
        <h2>{showHistory ? "Change history" : "Agent configuration"}</h2>
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
          className="g-button g-button-ghost g-button-icon g-button-28"
          aria-label="Refresh"
          title="Refresh"
          disabled={loading || busy}
          onClick={refresh}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      {inventory?.notices.length ? (
        <details className="settings-disclosure config-sync-notices">
          <summary>Some configuration needs attention ({inventory.notices.length})</summary>
          <ul>
            {[...new Set(inventory.notices)].map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {status ? (
        <p className={status.completed ? "settings-footnote" : "settings-error"} role="status">
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
      {showHistory ? (
        <div className="settings-group">
          {!history.length && !loading ? (
            <div className="config-sync-blank">
              <h3>No changes yet</h3>
              <p>Configuration changes applied on this device appear here.</p>
            </div>
          ) : null}
          {history.map((receipt) => (
            <div className="settings-row" key={receipt.id}>
              <div className="settings-row-text">
                <div>
                  <strong className="config-sync-name">{receipt.label}</strong>
                  <p>
                    {PROVIDERS[receipt.provider]} ·{" "}
                    {receipt.status === "recovery_required"
                      ? "Recovery required"
                      : receipt.status === "rolled_back"
                        ? "Restored"
                        : "Applied"}
                  </p>
                </div>
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
          {!inventory?.items.length && !loading && !error ? (
            <div className="config-sync-blank">
              <h3>Nothing to sync yet</h3>
              <p>Add instructions, skills or settings through an installed agent, then refresh.</p>
            </div>
          ) : null}
          {groups(inventory?.items ?? []).map(([provider, items]) => (
            <AgentGroup
              key={provider}
              provider={provider}
              items={items}
              paused={inventory?.paused.includes(provider) ?? false}
              busy={busy || loading}
              onSync={(enabled) =>
                void action(async () => {
                  await api.setAgentSync(provider, enabled);
                  if (alive.current) refresh();
                })
              }
              onApplyAll={() =>
                void action(async () => {
                  const outcomes = await api.applyAgent(provider);
                  const done = outcomes.filter((outcome) => outcome.completed).length;
                  const failed = outcomes.find((outcome) => !outcome.completed);
                  completed({
                    item_id: failed?.item_id ?? "",
                    receipt_id: null,
                    completed: !failed,
                    message: failed
                      ? `${done} of ${outcomes.length} applied. ${failed.message}`
                      : `${done} ${done === 1 ? "item" : "items"} applied.`,
                  });
                })
              }
              onDeviceOnly={(item, checked) =>
                void action(async () => {
                  await api.deviceOnly(item.id, checked);
                  if (alive.current) refresh();
                })
              }
              onReview={setSelected}
            />
          ))}
          {inventory?.next_cursor ? (
            <button
              type="button"
              className="settings-link config-sync-more"
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
              <span>Load more</span>
            </button>
          ) : null}
        </div>
      )}
      {selected ? (
        <ConfigReview
          key={selected.id}
          item={selected}
          api={api}
          vendorApi={vendorApi}
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
  vendorApi,
  onClose,
  onComplete,
}: {
  readonly item: ConfigSyncItem;
  readonly api: ConfigSyncApi;
  readonly vendorApi?: VendorApi;
  readonly onClose: () => void;
  readonly onComplete: (outcome: ConfigSyncOutcome) => void;
}) {
  const [choice, setChoice] = useState<ConfigSyncChoice>("automatic");
  const [preview, setPreview] = useState<ConfigSyncPreview | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const finishVendor = async (exitCode: number | null) => {
    const reviewed = token.current;
    if (!reviewed || consuming.current) return;
    consuming.current = true;
    token.current = null;
    setBusy(true);
    try {
      const outcome = await api.vendorFinish(reviewed, exitCode === 0, exitCode);
      if (alive.current) onComplete(outcome);
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      consuming.current = false;
      if (alive.current) setBusy(false);
    }
  };
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
          {preview.vendor_steps.length ? (
            <ol className="config-sync-steps" aria-label="Installer steps">
              {preview.vendor_steps.map((entry, index) => (
                <li key={`${entry.kind}:${entry.target}`}>
                  <span>
                    {entry.kind === "marketplace" ? "Add the marketplace " : "Install "}
                    <code>{entry.target}</code>
                  </span>
                  <button
                    type="button"
                    className="g-button g-button-outline g-button-28"
                    disabled={busy}
                    onClick={() => setStep(index)}
                  >
                    {entry.kind === "marketplace" ? "Add…" : "Install…"}
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {step !== null && preview.vendor_steps[step] ? (
            <VendorDialog
              api={vendorApi}
              preset={{
                provider: preview.vendor_steps[step].provider as VendorProvider,
                kind: preview.vendor_steps[step].kind,
                action: "install",
                target: preview.vendor_steps[step].target,
              }}
              onClose={() => setStep(null)}
              onFinished={(exitCode) => {
                // The last step is the install that makes this declaration true here.
                if (step === preview.vendor_steps.length - 1) void finishVendor(exitCode);
              }}
            />
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

import { AgentMark } from "@auracode/ui/graphite";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { vendorApi as nativeVendorApi, type VendorApi } from "../../lib/config-vendor/api";
import { errorMessage } from "../../lib/errors";
import { type LibraryApi, libraryApi } from "../../lib/library/api";
import type {
  LibraryCopyPreview,
  LibraryCopyReceipt,
  LibraryInventory,
  LibraryItem,
  LibraryItemKind,
  LibraryItemPreview,
  LibrarySourceStatus,
} from "../../lib/library/bindings";
import { Modal } from "../chat/Modal";
import { VendorDialog } from "./VendorDialog";
import "./library.css";

const LABELS = { claude: "Claude", codex: "Codex", pi: "Pi", shared: "Shared" };
const KINDS = [
  { value: "all", label: "Everything" },
  { value: "skill", label: "Skills" },
  { value: "instructions", label: "Instructions" },
  { value: "mcp_server", label: "MCP servers" },
  { value: "plugin", label: "Plugins" },
  { value: "package", label: "Packages" },
] as const;

export interface LibraryFolder {
  readonly id: string;
  readonly label: string;
}
const itemKey = (item: LibraryItem) => JSON.stringify(item.item);
const sourceLabel = (source: LibrarySourceStatus) =>
  `${LABELS[source.provider]} · ${source.scope === "user" ? "Personal" : "Project"}${source.id.endsWith(":claude-mcp") ? " MCP" : ""}`;
const kindLabel = (kind: LibraryItemKind) =>
  KINDS.find((entry) => entry.value === kind)?.label ?? kind;
const sourceName = (sources: readonly LibrarySourceStatus[], id: string) => {
  const source = sources.find((entry) => entry.id === id);
  return source ? sourceLabel(source) : id;
};

/**
 * The Library (Vercel's project pages): the views on the left, what the agents use as rows on
 * hairlines, and the chosen item with its file in a well. Copies and restores are reviewed in a
 * dialog before anything changes an agent's files.
 */
export function LibraryScreen({
  onBack,
  initialFolderId = null,
  folders = [],
  api = libraryApi,
  vendorApi = nativeVendorApi,
}: {
  readonly onBack: () => void;
  readonly initialFolderId?: string | null;
  readonly folders?: readonly LibraryFolder[];
  readonly api?: LibraryApi;
  readonly vendorApi?: VendorApi;
}) {
  const [folder, setFolder] = useState(initialFolderId);
  const [generation, setGeneration] = useState(0);
  const [inventory, setInventory] = useState<LibraryInventory | null>(null);
  const [receipts, setReceipts] = useState<LibraryCopyReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<LibraryItemKind | "all">("all");
  const [provider, setProvider] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [vendor, setVendor] = useState<{ item: LibraryItem | null } | null>(null);
  const attention = useId();
  const refresh = () => setGeneration((value) => value + 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is the explicit Refresh action.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setInventory(null);
    setReceipts([]);
    setSelected(null);
    void Promise.allSettled([api.snapshot(folder), api.history(folder)]).then(([items, copies]) => {
      if (!current) return;
      if (items.status === "fulfilled") setInventory(items.value);
      else setError(errorMessage(items.reason));
      if (copies.status === "fulfilled") setReceipts(copies.value);
      else setError(`Copy history could not be read. ${errorMessage(copies.reason)}`);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [api, folder, generation]);
  const visible = (inventory?.items ?? []).filter(
    (item) =>
      (kind === "all" || item.item.kind === kind) &&
      (provider === "all" || item.provider === provider) &&
      `${item.label} ${item.relative_path} ${LABELS[item.provider]}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const chosen = visible.find((item) => itemKey(item) === selected) ?? null;
  const recovery = receipts.some((receipt) => receipt.state === "recovery_required");
  const unavailable = inventory?.sources.filter((source) => !source.available) ?? [];
  const complete = (message: string) => {
    setStatus(message);
    refresh();
  };
  return (
    <main className="library-screen g-root">
      <div className="library-drag" data-tauri-drag-region="" />
      <header className="library-topbar">
        <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
      </header>
      <div className="library-heading">
        <div>
          <h1>Library</h1>
          <p>The instructions and tools your agents use.</p>
        </div>
        <div className="library-heading-actions">
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon"
            aria-label="Refresh Library"
            title="Refresh"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="g-button g-button-outline"
            onClick={() => setVendor({ item: null })}
          >
            Manage integrations
          </button>
        </div>
      </div>
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={16} aria-hidden="true" />
          <input
            className="g-input"
            aria-label="Search Library"
            type="search"
            placeholder="Find a skill, instruction or tool…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select
          className="g-select library-select"
          aria-label="Project configuration source"
          value={folder ?? ""}
          onChange={(event) => setFolder(event.currentTarget.value || null)}
        >
          <option value="">Personal configuration</option>
          {initialFolderId && !folders.some((item) => item.id === initialFolderId) ? (
            <option value={initialFolderId}>Selected project</option>
          ) : null}
          {folders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className="g-select library-select"
          aria-label="Filter by agent"
          value={provider}
          onChange={(event) => setProvider(event.currentTarget.value)}
        >
          <option value="all">All agents</option>
          {Object.entries(LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="library-feedback" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="library-feedback" role="status">
          {status}
        </p>
      ) : null}
      <div className="library-body">
        <nav className="library-categories" aria-label="Library categories">
          {KINDS.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              aria-current={!history && kind === value ? "page" : undefined}
              onClick={() => {
                setKind(value);
                setHistory(false);
              }}
            >
              <span>{label}</span>
              <small>
                {inventory?.items.filter((item) => value === "all" || item.item.kind === value)
                  .length ?? 0}
              </small>
            </button>
          ))}
          <hr />
          <button
            type="button"
            aria-current={history ? "page" : undefined}
            aria-describedby={recovery ? attention : undefined}
            onClick={() => setHistory(true)}
          >
            <span>Copy history</span>
            {recovery ? <span className="library-attention" aria-hidden="true" /> : null}
          </button>
          {recovery ? (
            <span id={attention} hidden>
              A copy needs review.
            </span>
          ) : null}
          {inventory?.sources.length ? (
            <details className="library-sources">
              <summary>
                Sources
                <small>
                  {unavailable.length
                    ? `${unavailable.length} unavailable`
                    : `${inventory.sources.length} available`}
                </small>
              </summary>
              {inventory.sources.map((source) => (
                <p key={source.id}>
                  {sourceLabel(source)}
                  <small>
                    {source.available ? "Available" : (source.message ?? "Unavailable")}
                  </small>
                </p>
              ))}
            </details>
          ) : null}
        </nav>
        {history ? (
          <HistoryView
            key={`${folder}:${generation}`}
            api={api}
            folder={folder}
            receipts={receipts}
            sources={inventory?.sources ?? []}
            complete={complete}
          />
        ) : (
          <>
            <section className="library-items" aria-label="Library items">
              {loading ? (
                <p className="library-empty" role="status">
                  Reading configuration…
                </p>
              ) : visible.length === 0 ? (
                <div className="library-empty">
                  <h2>{query ? "No matching items" : "Nothing here yet"}</h2>
                  <p>
                    {query
                      ? "Try a different name or agent."
                      : "Items appear when these sources hold supported files."}
                  </p>
                </div>
              ) : (
                <ul>
                  {visible.map((item, index) => (
                    <li
                      key={itemKey(item)}
                      className="g-enter"
                      style={{ "--g-row-index": Math.min(index, 8) } as CSSProperties}
                    >
                      <button
                        type="button"
                        aria-pressed={selected === itemKey(item)}
                        onClick={() => setSelected(itemKey(item))}
                      >
                        <span className="library-mark" aria-hidden="true">
                          <AgentMark agent={item.provider} size={24} />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {LABELS[item.provider]} ·{" "}
                            {item.scope === "user" ? "Personal" : "Project"}
                            {kind === "all" ? ` · ${kindLabel(item.item.kind)}` : ""}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {inventory?.notices.length ? (
                <details className="library-notices">
                  <summary>
                    {inventory.notices.length}{" "}
                    {inventory.notices.length === 1 ? "source notice" : "source notices"}
                  </summary>
                  {inventory.notices.map((notice) => (
                    <p key={notice}>{notice}</p>
                  ))}
                </details>
              ) : null}
            </section>
            {chosen ? (
              <ItemDetail
                key={`${folder}:${generation}:${itemKey(chosen)}`}
                api={api}
                folder={folder}
                item={chosen}
                sources={inventory?.sources ?? []}
                complete={complete}
                manage={() => setVendor({ item: chosen })}
              />
            ) : (
              <section className="library-detail library-unselected" aria-label="Item preview">
                <h2>No item selected</h2>
                <p>Choose an item to read it and review a copy.</p>
              </section>
            )}
          </>
        )}
      </div>
      {vendor ? (
        <VendorDialog
          api={vendorApi}
          initial={vendor.item}
          onClose={() => {
            setVendor(null);
            refresh();
          }}
        />
      ) : null}
    </main>
  );
}

function ItemDetail({
  api,
  folder,
  item,
  sources,
  complete,
  manage,
}: {
  readonly api: LibraryApi;
  readonly folder: string | null;
  readonly item: LibraryItem;
  readonly sources: readonly LibrarySourceStatus[];
  readonly complete: (message: string) => void;
  readonly manage: () => void;
}) {
  const [preview, setPreview] = useState<LibraryItemPreview | null>(null);
  const [plan, setPlan] = useState<LibraryCopyPreview | null>(null);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    void api
      .preview(folder, item.item, item.revision)
      .then((value) => {
        if (alive.current) setPreview(value);
      })
      .catch((reason) => {
        if (alive.current) setError(errorMessage(reason));
      });
    return () => {
      alive.current = false;
      if (pending.current) void api.cancel(pending.current).catch(() => {});
    };
  }, [api, folder, item]);
  const cancel = () => {
    if (busy) return;
    const id = pending.current;
    pending.current = null;
    setPlan(null);
    if (id) void api.cancel(id).catch((reason) => setError(errorMessage(reason)));
  };
  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await api.prepare(folder, item.item, item.revision, target);
      if (!alive.current) {
        await api.cancel(value.id);
        return;
      }
      pending.current = value.id;
      setPlan(value);
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    pending.current = null;
    try {
      const result = await api.apply(plan.id);
      if (alive.current)
        complete(
          result.recovery_required
            ? (result.message ?? "Copy interrupted. Open Copy history to recover.")
            : "Copy saved. Originals are available in Copy history.",
        );
    } catch (reason) {
      if (alive.current) {
        setPlan(null);
        setError(errorMessage(reason));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const blocked =
    item.copy_blocked ??
    (!["skill", "instructions", "mcp_server"].includes(item.item.kind)
      ? "Copying this item needs its agent's configuration workflow. You can read it here."
      : null);
  const destinations = sources.filter(
    (source) =>
      source.available &&
      source.id !== item.item.source_id &&
      (item.item.kind === "mcp_server"
        ? source.provider !== "claude" ||
          source.scope === "project" ||
          source.id.endsWith(":claude-mcp")
        : !source.id.endsWith(":claude-mcp")) &&
      (source.provider !== "shared" || item.item.kind === "skill"),
  );
  const managed =
    (item.item.kind === "plugin" || item.item.kind === "package") && item.provider !== "shared";
  return (
    <section className="library-detail" aria-label="Item preview">
      <header>
        <div>
          <h2>{item.label}</h2>
          <p>
            {LABELS[item.provider]} · {item.scope === "user" ? "Personal" : "Project"} ·{" "}
            {kindLabel(item.item.kind)}
          </p>
          <code>{item.relative_path}</code>
        </div>
        {managed && item.scope === "user" ? (
          <button type="button" className="g-button g-button-outline g-button-28" onClick={manage}>
            Manage with {LABELS[item.provider]}
          </button>
        ) : null}
      </header>
      {managed && item.scope !== "user" ? (
        <p className="library-detail-note">
          Manage this project integration through its vendor. Personal ones are in Manage
          integrations.
        </p>
      ) : null}
      {error ? (
        <p className="library-feedback" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <>
          <div className="library-well">
            <div className="library-file-heading">
              <span>{item.relative_path.split("/").pop()}</span>
              <small>
                {preview.files.length > 1
                  ? `${preview.files.length} files`
                  : `${item.bytes.toLocaleString()} bytes`}
              </small>
            </div>
            <pre className="library-code">{preview.text}</pre>
          </div>
          {preview.files.length > 1 ? (
            <details className="library-file-list">
              <summary>Supporting files</summary>
              <ul>
                {preview.files.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {preview.notices.map((notice) => (
            <p key={notice} className="library-detail-note">
              {notice}
            </p>
          ))}
        </>
      ) : !error ? (
        <p role="status" className="library-detail-note">
          Reading item…
        </p>
      ) : null}
      <div className="library-copy-controls">
        {blocked ? (
          <p>{blocked}</p>
        ) : (
          <>
            <label>
              Copy to
              <select
                className="g-select"
                aria-label="Copy destination"
                value={target}
                disabled={busy || !preview}
                onChange={(event) => setTarget(event.currentTarget.value)}
              >
                <option value="">Choose an agent and scope</option>
                {destinations.map((source) => (
                  <option key={source.id} value={source.id}>
                    {sourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="g-button g-button-primary g-button-36"
              disabled={busy || !target || !preview}
              onClick={() => void prepare()}
            >
              {busy ? "Preparing…" : "Review copy"}
            </button>
          </>
        )}
      </div>
      {plan ? (
        <Modal title="Review copy" size="lg" className="library-review" onClose={cancel}>
          <p className="library-review-intro">
            Copying <strong>{item.label}</strong> from{" "}
            <strong>{sourceName(sources, item.item.source_id)}</strong> to{" "}
            <strong>{sourceName(sources, plan.to_source)}</strong>.
          </p>
          <div className="library-comparison">
            <section>
              <h3>Before</h3>
              <pre>{plan.before_text ?? "New file"}</pre>
            </section>
            <section>
              <h3>After</h3>
              <pre>{plan.after_text}</pre>
            </section>
          </div>
          <details className="library-review-files">
            <summary>
              {plan.files.length} {plan.files.length === 1 ? "file" : "files"} in this copy
            </summary>
            <ul>
              {plan.files.map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code>
                  <span>{file.before_revision ? "Replace" : "Create"}</span>
                </li>
              ))}
            </ul>
          </details>
          {plan.notices.map((notice) => (
            <p className="library-detail-note" key={notice}>
              {notice}
            </p>
          ))}
          <div className="g-dialog-actions library-actions">
            <button type="button" className="g-button" disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? "Saving…" : "Apply copy"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function HistoryView({
  api,
  folder,
  receipts,
  sources,
  complete,
}: {
  readonly api: LibraryApi;
  readonly folder: string | null;
  readonly receipts: readonly LibraryCopyReceipt[];
  readonly sources: readonly LibrarySourceStatus[];
  readonly complete: (message: string) => void;
}) {
  const [selected, setSelected] = useState<LibraryCopyReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.rollback(folder, selected.source_id, selected.id);
      setSelected(null);
      complete(
        result.recovery_required
          ? (result.message ?? "Recovery needs another review.")
          : "Original files restored.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="library-history" aria-label="Copy history">
      <h2>Copy history</h2>
      <p>Restore the original files after a copy. Files edited since are left alone.</p>
      {receipts.length === 0 ? (
        <div className="library-empty">
          <h3>No copies yet</h3>
          <p>Copies you apply from the Library appear here.</p>
        </div>
      ) : (
        <ul>
          {receipts.map((receipt) => (
            <li key={`${receipt.source_id}:${receipt.id}`} data-state={receipt.state}>
              <div>
                <strong>{receipt.files.join(", ")}</strong>
                <small>
                  {sourceName(sources, receipt.source_id)} ·{" "}
                  <span className="library-receipt-state">
                    {receipt.state === "complete"
                      ? "Copied"
                      : receipt.state === "rolled_back"
                        ? "Restored"
                        : "Needs recovery"}
                  </span>
                </small>
              </div>
              <code title="Copy receipt">{receipt.id}</code>
              <button
                type="button"
                className="g-button g-button-outline g-button-28"
                disabled={receipt.state === "rolled_back"}
                onClick={() => setSelected(receipt)}
              >
                Review restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <Modal
          title="Restore original files?"
          size="md"
          className="library-review"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <p className="library-review-intro">
            Restores the files kept from before this copy to{" "}
            <strong>{sourceName(sources, selected.source_id)}</strong>. If one was edited since,
            nothing changes.
          </p>
          <ul className="library-restore-files">
            {selected.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="library-dialog-error">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions library-actions">
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? "Restoring…" : "Restore originals"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

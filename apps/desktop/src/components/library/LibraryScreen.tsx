import { AgentMark } from "@auracode/ui/graphite";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  History,
  Package,
  Plug,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  { value: "all", label: "Everything", icon: BookOpen },
  { value: "skill", label: "Skills", icon: Wrench },
  { value: "instructions", label: "Instructions", icon: FileText },
  { value: "mcp_server", label: "MCP servers", icon: Plug },
  { value: "plugin", label: "Plugins", icon: Package },
  { value: "package", label: "Packages", icon: Package },
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
        <h1>
          Library
          <span>The instructions and tools your agents use.</span>
        </h1>
        <div className="library-heading-actions">
          <button
            type="button"
            className="g-button g-button-outline"
            onClick={() => setVendor({ item: null })}
          >
            <Package size={14} aria-hidden="true" /> Manage integrations
          </button>
          <button
            type="button"
            className="g-button g-button-outline library-toggle"
            aria-pressed={history}
            onClick={() => setHistory(!history)}
          >
            <History size={14} aria-hidden="true" /> Copy history
            {receipts.some((receipt) => receipt.state === "recovery_required")
              ? " · Needs review"
              : ""}
          </button>
          <button
            type="button"
            className="g-button g-button-ghost"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh
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
        <label className="library-select">
          Source
          <select
            className="g-input"
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
        </label>
        <label className="library-select">
          Agent
          <select
            className="g-input"
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
        </label>
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
          {KINDS.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              aria-current={!history && kind === value ? "page" : undefined}
              onClick={() => {
                setKind(value);
                setHistory(false);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              <small>
                {inventory?.items.filter((item) => value === "all" || item.item.kind === value)
                  .length ?? 0}
              </small>
            </button>
          ))}
          <div className="library-source-note">
            <span>On this device</span>
            <p>Copies are reviewed before they change an agent's files.</p>
          </div>
          <details className="library-sources">
            <summary>Configuration sources</summary>
            {inventory?.sources.map((source) => (
              <p key={source.id}>
                {sourceLabel(source)}
                <small>{source.available ? "Available" : (source.message ?? "Unavailable")}</small>
              </p>
            ))}
          </details>
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
              <div className="library-list-heading">
                <span>{KINDS.find((entry) => entry.value === kind)?.label}</span>
                <small>{visible.length} items</small>
              </div>
              {loading ? (
                <p className="library-empty" role="status">
                  Reading configuration…
                </p>
              ) : visible.length === 0 ? (
                <div className="library-empty">
                  <BookOpen size={20} aria-hidden="true" />
                  <h2>{query ? "No matching items" : "Nothing here yet"}</h2>
                  <p>
                    {query
                      ? "Try a different name or agent."
                      : "Items appear here when supported configuration files exist in these sources."}
                  </p>
                </div>
              ) : (
                <ul>
                  {visible.map((item) => (
                    <li key={itemKey(item)}>
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
                            {item.scope === "user" ? "Personal" : "Project"} ·{" "}
                            {kindLabel(item.item.kind)}
                          </small>
                        </span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {inventory?.notices.length ? (
                <details className="library-notices">
                  <summary>{inventory.notices.length} source notices</summary>
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
                <FileText size={20} aria-hidden="true" />
                <h2>No item selected</h2>
                <p>Select an item to inspect its contents and review a copy.</p>
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
      ? "Copying this item needs its agent's configuration workflow. Inspection is available here."
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
  return (
    <section className="library-detail" aria-label="Item preview">
      <header>
        <h2>{item.label}</h2>
        <p>
          {LABELS[item.provider]} · {item.scope === "user" ? "Personal" : "Project"}
          <span className="library-kind">{kindLabel(item.item.kind)}</span>
        </p>
        <code>{item.relative_path}</code>
        {(item.item.kind === "plugin" || item.item.kind === "package") &&
        item.provider !== "shared" ? (
          item.scope === "user" ? (
            <button
              type="button"
              className="g-button g-button-outline g-button-28"
              onClick={manage}
            >
              Manage with {LABELS[item.provider]}
            </button>
          ) : (
            <p>
              Manage this project integration through its vendor. Personal actions are available in
              Manage integrations.
            </p>
          )
        ) : null}
      </header>
      {error ? (
        <p className="library-feedback" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <>
          <div className="library-file-heading">
            <span>Contents</span>
            <small>
              {preview.files.length > 1
                ? `${preview.files.length} files`
                : `${item.bytes.toLocaleString()} bytes`}
            </small>
          </div>
          <pre className="library-code">{preview.text}</pre>
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
        <p role="status">Reading item…</p>
      ) : null}
      <div className="library-copy-controls">
        {blocked ? (
          <p>{blocked}</p>
        ) : (
          <>
            <label>
              Copy to
              <select
                className="g-input"
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
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {plan ? (
        <Modal title="Review copy" className="library-review" onClose={cancel}>
          <p className="library-review-intro">
            {item.label} <ArrowRight size={14} aria-hidden="true" />{" "}
            {sources.find((source) => source.id === plan.to_source)
              ? sourceLabel(
                  sources.find((source) => source.id === plan.to_source) as LibrarySourceStatus,
                )
              : plan.to_source}
          </p>
          <div className="library-comparison">
            <section>
              <h3>Before</h3>
              <pre className="library-code">{plan.before_text ?? "New file"}</pre>
            </section>
            <section>
              <h3>After</h3>
              <pre className="library-code">{plan.after_text}</pre>
            </section>
          </div>
          <details>
            <summary>{plan.files.length} files in this copy</summary>
            <ul>
              {plan.files.map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code> · {file.before_revision ? "Replace" : "Create"}
                </li>
              ))}
            </ul>
          </details>
          {plan.notices.map((notice) => (
            <p className="library-detail-note" key={notice}>
              {notice}
            </p>
          ))}
          <footer>
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
          </footer>
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
      <p>Restore original files after a copy. Later edits are protected.</p>
      {receipts.length === 0 ? (
        <p className="library-empty">No retained copies in these sources.</p>
      ) : (
        <ul>
          {receipts.map((receipt) => (
            <li key={`${receipt.source_id}:${receipt.id}`}>
              <div>
                <strong>
                  {sources.find((source) => source.id === receipt.source_id)
                    ? sourceLabel(
                        sources.find(
                          (source) => source.id === receipt.source_id,
                        ) as LibrarySourceStatus,
                      )
                    : receipt.source_id}
                </strong>
                <span>{receipt.files.join(", ")}</span>
                <small>
                  {receipt.state === "complete"
                    ? "Copied"
                    : receipt.state === "rolled_back"
                      ? "Restored"
                      : "Recovery needed"}{" "}
                  · {receipt.id}
                </small>
              </div>
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
          className="library-review"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <p>
            This restores the retained originals for the selected copy. If any affected file has
            been edited since, the operation stops before making a change.
          </p>
          <ul>
            {selected.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="library-feedback">
              {error}
            </p>
          ) : null}
          <footer>
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
          </footer>
        </Modal>
      ) : null}
    </section>
  );
}

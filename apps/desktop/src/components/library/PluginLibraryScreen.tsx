import { AgentMark, StatusDot } from "@auracode/ui/graphite";
import { ArrowLeft, Ellipsis, Plus, RefreshCw, Search } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AgentPlugins,
  FeatureListing,
  PluginEntry,
  PluginLibrary,
  VendorAction,
  VendorProvider,
} from "../../bindings";
import { vendorApi as nativeVendorApi, type VendorApi } from "../../lib/config-vendor/api";
import { errorMessage } from "../../lib/errors";
import { type LibraryApi, libraryApi as nativeLibraryApi } from "../../lib/library/api";
import type {
  LibraryCopyReceipt,
  LibraryItem,
  LibrarySourceStatus,
} from "../../lib/library/bindings";
import { pluginsApi as nativePluginsApi, type PluginsApi } from "../../lib/plugins/api";
import {
  addsMarketplaces,
  ago,
  featureLabel,
  harnessText,
  harnessTone,
  sourceText,
} from "../../lib/plugins/format";
import { PluginLibraryLoader } from "../../lib/plugins/loading";
import type { SharedMcpApi } from "../../lib/sharedMcp";
import { Modal } from "../chat/Modal";
import { HistoryView, ItemDetail } from "./LibraryItems";
import { type McpProject, SharedMcpPanel } from "./SharedMcpPanel";
import { VendorDialog, type VendorPreset } from "./VendorDialog";
import "./library.css";
import "./plugin-library.css";

const AVAILABLE_SHOWN = 20;

interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * A row's kebab (Vercel's project menu): plain items; arrows move, Escape closes and returns.
 *
 * The menu is fixed beside its trigger, so it closes once the trigger moves under it (a scroll of
 * the page, a resized window). A scroll event alone does not close it: one that ends a scroll made
 * before the menu opened (bringing the row into view, then clicking) arrives a frame later, and
 * the trigger has not moved since the menu was placed.
 */
function RowMenu({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly MenuItem[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const placedAt = useRef<{ top: number; right: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    placedAt.current = { top: box.top, right: box.right };
    const height = menu.current?.offsetHeight ?? 0;
    const below = box.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({
      top: below ? box.bottom + 4 : Math.max(8, box.top - 4 - height),
      right: Math.max(8, window.innerWidth - box.right),
    });
    // The menu is not placed until the next render: focusing it must not scroll anything.
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const dismiss = () => close(false);
    const moved = () => {
      const box = trigger.current?.getBoundingClientRect();
      const placed = placedAt.current;
      if (
        !box ||
        !placed ||
        Math.abs(box.top - placed.top) > 1 ||
        Math.abs(box.right - placed.right) > 1
      )
        close(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", moved, true);
    };
  });
  const move = (event: React.KeyboardEvent) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => entries[(index + entries.length) % entries.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Escape" || event.key === "Tab") close();
    else return;
    if (event.key !== "Tab") event.preventDefault();
    event.stopPropagation();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="g-button g-button-ghost g-button-icon g-button-28"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              className="g-root g-menu plugins-menu"
              style={place}
              onKeyDown={move}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="g-menu-item"
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            trigger.current?.closest("main") ?? document.body,
          )
        : null}
    </>
  );
}

/**
 * The Plugins & MCP (Vercel's project pages): the agents on the left, and for the chosen agent
 * its harness status, its sync switch and what it supports, each feature as rows on hairlines with
 * where they came from. Rows read from the agent's own CLI where it lists them; the rest come from
 * its files. Every change runs the agent's own reviewed command in a terminal first.
 */
export function PluginLibraryScreen({
  onBack,
  onAgents,
  initialAgent = "claude",
  api = nativePluginsApi,
  libraryApi = nativeLibraryApi,
  vendorApi = nativeVendorApi,
  now = Date.now,
  embedded = false,
  titled = true,
  initialProjectId = null,
  projects = [],
  mcpApi,
  activeChatId,
}: {
  readonly onBack: () => void;
  readonly onAgents?: () => void;
  readonly initialAgent?: string;
  readonly api?: PluginsApi;
  readonly libraryApi?: LibraryApi;
  readonly vendorApi?: VendorApi;
  readonly now?: () => number;
  readonly embedded?: boolean;
  /** Settings names the page itself: the library then shows only its description and Refresh. */
  readonly titled?: boolean;
  readonly initialProjectId?: string | null;
  readonly projects?: readonly McpProject[];
  readonly mcpApi?: SharedMcpApi;
  readonly activeChatId?: string | null;
}) {
  const [library, setLibrary] = useState<PluginLibrary | null>(null);
  const [selected, setSelected] = useState(initialAgent);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "update" | "sync" | null>(null);
  const [vendor, setVendor] = useState<VendorPreset | null>(null);
  const [preview, setPreview] = useState<{
    item: LibraryItem;
    sources: LibrarySourceStatus[];
  } | null>(null);
  const [history, setHistory] = useState<{
    receipts: LibraryCopyReceipt[];
    sources: LibrarySourceStatus[];
  } | null>(null);
  const alive = useRef(true);
  const loader = useRef(new PluginLibraryLoader());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      loader.current.cancel();
    };
  }, []);
  const load = async (refresh: boolean) => {
    if (!alive.current) return;
    if (refresh) setBusy("refresh");
    setError(null);
    await loader.current.load(api, refresh, {
      value: (value) => {
        setLibrary(value);
        setLoading(false);
      },
      error: (reason) => setError(errorMessage(reason)),
      done: () => {
        setLoading(false);
        if (refresh) setBusy(null);
      },
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the first read only; Refresh reruns it.
  useEffect(() => {
    void load(false);
  }, [api]);
  const agent = library?.agents.find((entry) => entry.agent_id === selected) ?? null;
  const openItem = async (entry: PluginEntry) => {
    const ref = entry.library;
    if (!ref) return;
    setError(null);
    try {
      const inventory = await libraryApi.snapshot(null);
      const item = inventory.items.find(
        (candidate) =>
          candidate.item.source_id === ref.source_id &&
          candidate.item.kind === ref.kind &&
          candidate.item.key === ref.key,
      );
      if (!item) throw new Error("This item changed. Refresh the Plugins & MCP and try again.");
      if (alive.current) setPreview({ item, sources: inventory.sources });
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    }
  };
  const openHistory = async () => {
    setError(null);
    try {
      const [inventory, receipts] = await Promise.all([
        libraryApi.snapshot(null),
        libraryApi.history(null),
      ]);
      if (alive.current) setHistory({ receipts, sources: inventory.sources });
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    }
  };
  const update = async (target: AgentPlugins) => {
    setBusy("update");
    setStatus(null);
    setError(null);
    try {
      await api.update(target.agent_id);
      if (alive.current) setStatus(`${target.name} updated. Its plugins were read again.`);
      await load(false);
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const setSync = async (target: AgentPlugins, enabled: boolean) => {
    setBusy("sync");
    setError(null);
    try {
      await api.setSync(target.agent_id, enabled);
      await load(false);
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const Container = embedded ? "section" : "main";
  return (
    <Container
      className="library-screen plugins-screen g-root"
      data-embedded={embedded || undefined}
    >
      {!embedded ? (
        <>
          <div className="library-drag" data-tauri-drag-region="" />
          <header className="library-topbar">
            <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
              <ArrowLeft size={14} aria-hidden="true" /> Back
            </button>
          </header>
        </>
      ) : null}
      <div className="library-heading">
        <div>
          {titled ? <h1>Plugins & MCP</h1> : null}
          <p>
            Plugins stay with their agent. Shared MCP applies to compatible agents in the selected
            scope. Server definitions can sync; authentication stays on each device.
          </p>
        </div>
        <div className="library-heading-actions">
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon"
            aria-label="Refresh Plugins & MCP"
            title="Refresh"
            onClick={() => void load(true)}
            disabled={loading || busy !== null}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
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
      <div className="plugins-body">
        <nav className="plugins-agents" aria-label="Agents">
          <button
            type="button"
            aria-current={selected === "shared" ? "page" : undefined}
            onClick={() => setSelected("shared")}
          >
            Shared MCP
          </button>
          {(library?.agents ?? []).map((entry) => (
            <button
              type="button"
              key={entry.agent_id}
              aria-current={entry.agent_id === selected ? "page" : undefined}
              onClick={() => setSelected(entry.agent_id)}
            >
              <span className="plugins-agent-mark" aria-hidden="true">
                <AgentMark agent={entry.agent_id} size={16} ghost={!entry.installed} />
              </span>
              <span className="plugins-agent-name">{entry.name}</span>
              {harnessTone(entry.harness) === "volt" ? (
                <span className="plugins-agent-dot" title="Update available">
                  <StatusDot tone="volt" label="Update available" />
                </span>
              ) : null}
            </button>
          ))}
          {library?.notices.length ? (
            <p className="plugins-agents-note">{library.notices[library.notices.length - 1]}</p>
          ) : null}
        </nav>
        <section className="plugins-main" aria-label={agent ? agent.name : "Plugins & MCP"}>
          {selected === "shared" ? (
            <SharedMcpPanel
              projects={projects}
              initialProjectId={initialProjectId}
              api={mcpApi}
              activeChatId={activeChatId}
            />
          ) : loading ? (
            <p className="plugins-empty" role="status">
              Reading what your agents use…
            </p>
          ) : agent ? (
            <AgentSection
              key={agent.agent_id}
              agent={agent}
              busy={busy}
              now={now}
              onUpdate={() => void update(agent)}
              onSync={(enabled) => void setSync(agent, enabled)}
              onVendor={setVendor}
              onOpen={(entry) => void openItem(entry)}
              onHistory={() => void openHistory()}
              onRefresh={() => void load(true)}
              onAgents={onAgents}
            />
          ) : (
            <div className="plugins-empty">
              <h2>Nothing to show</h2>
              <p>Refresh to read your agents again.</p>
            </div>
          )}
        </section>
      </div>
      {vendor ? (
        <VendorDialog
          api={vendorApi}
          preset={vendor}
          capabilities={library?.agents.flatMap((agent) =>
            agent.management ? [agent.management] : [],
          )}
          onClose={() => {
            setVendor(null);
            void load(true);
          }}
        />
      ) : null}
      {preview ? (
        <Modal
          title={preview.item.label}
          size="lg"
          className="plugins-item-dialog"
          onClose={() => setPreview(null)}
        >
          <ItemDetail
            api={libraryApi}
            folder={null}
            item={preview.item}
            sources={preview.sources}
            complete={(message) => {
              setPreview(null);
              setStatus(message);
              void load(false);
            }}
            manage={() => setPreview(null)}
          />
        </Modal>
      ) : null}
      {history ? (
        <Modal
          title="Copy history"
          size="lg"
          className="plugins-item-dialog"
          onClose={() => setHistory(null)}
        >
          <HistoryView
            api={libraryApi}
            folder={null}
            receipts={history.receipts}
            sources={history.sources}
            complete={(message) => {
              setHistory(null);
              setStatus(message);
            }}
          />
        </Modal>
      ) : null}
    </Container>
  );
}

export function AgentSection({
  agent,
  busy,
  now,
  onUpdate,
  onSync,
  onVendor,
  onOpen,
  onHistory,
  onRefresh,
  onAgents,
}: {
  readonly agent: AgentPlugins;
  readonly busy: "refresh" | "update" | "sync" | null;
  readonly now: () => number;
  readonly onUpdate: () => void;
  readonly onSync: (enabled: boolean) => void;
  readonly onVendor: (preset: VendorPreset) => void;
  readonly onOpen: (entry: PluginEntry) => void;
  readonly onHistory: () => void;
  readonly onRefresh: () => void;
  readonly onAgents?: () => void;
}) {
  const management = agent.management?.version === 1 ? agent.management : null;
  const provider = management?.provider;
  const tone = harnessTone(agent.harness);
  const install =
    management?.actions.find(
      (action) => action.kind !== "marketplace" && action.actions.includes("install"),
    )?.kind ?? null;
  const menu: MenuItem[] = [{ label: "Refresh listings", onSelect: onRefresh }];
  if (provider && addsMarketplaces(management))
    menu.push({
      label: agent.agent_id === "hermes" ? "Add skill source…" : "Add marketplace…",
      onSelect: () => onVendor({ provider, kind: "marketplace", action: "install", target: "" }),
    });
  menu.push({ label: "Copy history", onSelect: onHistory });
  if (onAgents) menu.push({ label: "Open Agents", onSelect: onAgents });
  if (provider)
    for (const route of management?.native_routes ?? [])
      menu.push({
        label: route.label,
        onSelect: () => onVendor({ provider, kind: "native", action: "open", target: route.id }),
      });
  return (
    <div className="plugins-agent">
      <header className="plugins-agent-head">
        <span className="plugins-agent-head-mark" aria-hidden="true">
          <AgentMark agent={agent.agent_id} size={32} ghost={!agent.installed} />
        </span>
        <div className="plugins-agent-title">
          <h2>{agent.name}</h2>
          <p>
            {agent.version ? <code>{agent.version}</code> : null}
            {agent.version ? " · " : null}
            {agent.updated_at !== null
              ? `Updated ${ago(agent.updated_at, now())}`
              : !agent.installed && agent.harness.state === "checking"
                ? "Checking installation…"
                : agent.installed
                  ? "Read from its files"
                  : "Not installed here"}
          </p>
        </div>
        <div className="plugins-agent-actions">
          {provider && install && agent.installed ? (
            <button
              type="button"
              className="g-button g-button-primary g-button-28"
              onClick={() => onVendor({ provider, kind: install, action: "install", target: "" })}
            >
              {install === "package" ? "Add package" : "Add plugin"}
            </button>
          ) : null}
          <RowMenu label={`${agent.name} actions`} items={menu} />
        </div>
      </header>
      <div
        className="plugins-harness"
        data-tone={tone ?? undefined}
        role={agent.harness.state === "update_available" ? "status" : undefined}
      >
        {tone ? <StatusDot tone={tone} /> : null}
        <span>{harnessText(agent.name, agent.harness)}</span>
        {agent.harness.state === "update_available" ? (
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            disabled={busy !== null}
            aria-label={`Update ${agent.name} to ${agent.harness.latest}`}
            onClick={onUpdate}
          >
            {busy === "update" ? "Updating…" : "Update"}
          </button>
        ) : null}
      </div>
      {agent.version_change ? (
        <p className="plugins-note">
          {agent.name} changed from <code>{agent.version_change.from}</code> to{" "}
          <code>{agent.version_change.to}</code>, so its plugins were read again.
        </p>
      ) : null}
      <p className="plugins-summary">{agent.summary}</p>
      <div className="plugins-sync">
        <div>
          <strong>Sync across devices</strong>
          <span>
            {agent.sync.state === "unsupported"
              ? agent.sync.reason
              : agent.sync.state === "on"
                ? "Changes here are reviewed and shared with your other devices."
                : "Off on this device. Its items wait here unchanged."}
          </span>
        </div>
        {agent.sync.state !== "unsupported" ? (
          <input
            type="checkbox"
            role="switch"
            className="g-switch"
            aria-label={`Sync ${agent.name} across devices`}
            checked={agent.sync.state === "on"}
            aria-checked={agent.sync.state === "on"}
            disabled={busy !== null}
            onChange={(event) => onSync(event.currentTarget.checked)}
          />
        ) : null}
      </div>
      {agent.notices.map((notice) => (
        <p key={notice} className="plugins-note">
          {notice}
        </p>
      ))}
      {agent.features.map((feature) => (
        <Feature
          key={feature.feature}
          agent={agent}
          feature={feature}
          provider={provider}
          onVendor={onVendor}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function Feature({
  agent,
  feature,
  provider,
  onVendor,
  onOpen,
}: {
  readonly agent: AgentPlugins;
  readonly feature: FeatureListing;
  readonly provider: VendorProvider | undefined;
  readonly onVendor: (preset: VendorPreset) => void;
  readonly onOpen: (entry: PluginEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const label = featureLabel(feature.feature, agent.agent_id);
  const failed = feature.state.state === "failed";
  const matches = feature.available.filter((entry) =>
    `${entry.label} ${entry.description ?? ""} ${entry.marketplace ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const headingId = `plugins-${agent.agent_id}-${feature.feature}`;
  // Adding a marketplace sits where its list is, not only in the agent's menu.
  const adds =
    feature.feature === "marketplaces" &&
    provider !== undefined &&
    agent.installed &&
    addsMarketplaces(agent.management?.version === 1 ? agent.management : null);
  return (
    <section className="plugins-feature" aria-labelledby={headingId}>
      <div className="plugins-feature-head">
        <h3 id={headingId}>
          {label} <span className="plugins-count">{feature.entries.length}</span>
        </h3>
        <p className="plugins-source" data-failed={failed || undefined}>
          {sourceText(feature.state, feature.command)}
        </p>
        {adds && provider ? (
          <button
            type="button"
            className="g-button g-button-outline g-button-28 plugins-add"
            data-testid="add-marketplace"
            onClick={() =>
              onVendor({ provider, kind: "marketplace", action: "install", target: "" })
            }
          >
            <Plus size={14} aria-hidden="true" />
            {agent.agent_id === "hermes" ? "Add skill source" : "Add marketplace"}
          </button>
        ) : null}
      </div>
      {feature.entries.length ? (
        <ul className="plugins-rows">
          {feature.entries.map((entry) => (
            <Row
              key={entry.key}
              agent={agent}
              feature={feature}
              entry={entry}
              provider={provider}
              onVendor={onVendor}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <p className="plugins-none">
          {agent.installed ? `No ${label.toLowerCase()} yet.` : "Nothing here on this device."}
        </p>
      )}
      {feature.available_total > 0 ? (
        <div className="plugins-available">
          <div className="plugins-available-head">
            <h4>Available from your marketplaces</h4>
            <label className="library-search plugins-search">
              <Search size={16} aria-hidden="true" />
              <input
                className="g-input"
                type="search"
                aria-label={`Find an available ${agent.name} plugin`}
                placeholder="Find a plugin…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
          <ul className="plugins-rows">
            {matches.slice(0, AVAILABLE_SHOWN).map((entry) => (
              <Row
                key={entry.key}
                agent={agent}
                feature={feature}
                entry={entry}
                provider={provider}
                onVendor={onVendor}
                onOpen={onOpen}
              />
            ))}
          </ul>
          <p className="plugins-none">
            {matches.length === 0
              ? "No available plugin matches."
              : `Showing ${Math.min(AVAILABLE_SHOWN, matches.length)} of ${
                  query ? matches.length : feature.available_total
                }.`}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Row({
  agent,
  feature,
  entry,
  provider,
  onVendor,
  onOpen,
}: {
  readonly agent: AgentPlugins;
  readonly feature: FeatureListing;
  readonly entry: PluginEntry;
  readonly provider: VendorProvider | undefined;
  readonly onVendor: (preset: VendorPreset) => void;
  readonly onOpen: (entry: PluginEntry) => void;
}) {
  const capability =
    agent.management?.version === 1
      ? agent.management.actions.find((action) => action.feature === feature.feature)
      : null;
  const kind = capability?.kind ?? null;
  const vendor = (action: VendorAction) => () =>
    provider && kind ? onVendor({ provider, kind, action, target: entry.key }) : undefined;
  const items: MenuItem[] = [];
  if (entry.library) items.push({ label: "Preview and copy…", onSelect: () => onOpen(entry) });
  if (provider && kind && entry.installed && agent.installed) {
    if (capability?.actions.includes("enable") && capability.actions.includes("disable"))
      items.push(
        entry.enabled === false
          ? { label: "Enable…", onSelect: vendor("enable") }
          : { label: "Disable…", onSelect: vendor("disable") },
      );
    if (capability?.actions.includes("update"))
      items.push({ label: "Update…", onSelect: vendor("update") });
    if (capability?.actions.includes("remove"))
      items.push({ label: "Remove…", onSelect: vendor("remove") });
  }
  const facts = [
    entry.marketplace && entry.label !== entry.key ? entry.marketplace : null,
    entry.version,
    entry.kind,
    entry.scope && entry.scope !== "user" ? entry.scope : null,
    entry.local_fields.length
      ? `Keeps ${entry.local_fields.length === 1 ? "1 field" : `${entry.local_fields.length} fields`} on this device`
      : null,
  ].filter(Boolean);
  return (
    <li className="plugins-row">
      <div className="plugins-row-text">
        <strong>{entry.label}</strong>
        {entry.description || facts.length ? (
          <small>{[entry.description, ...facts].filter(Boolean).join(" · ")}</small>
        ) : null}
      </div>
      {entry.installed && entry.enabled !== null ? (
        <span className="plugins-row-state" data-enabled={entry.enabled}>
          {entry.enabled ? <StatusDot tone="green" /> : <span className="plugins-row-off" />}
          {entry.enabled ? "Enabled" : "Disabled"}
        </span>
      ) : null}
      {!entry.installed &&
      provider &&
      provider !== "grok" &&
      kind &&
      agent.installed &&
      capability?.actions.includes("install") ? (
        <button
          type="button"
          className="g-button g-button-outline g-button-28"
          aria-label={`Install ${entry.label}`}
          onClick={() => onVendor({ provider, kind, action: "install", target: entry.key })}
        >
          Install
        </button>
      ) : null}
      {/* Grok installs from a source, never a marketplace entry's name: its own CLI does. */}
      {!entry.installed && provider === "grok" && agent.installed ? (
        <button
          type="button"
          className="g-button g-button-outline g-button-28"
          onClick={() => onVendor({ provider, kind: "native", action: "open", target: "settings" })}
        >
          Install<span className="sr-only"> {entry.label}</span> in Grok…
        </button>
      ) : null}
      {items.length ? (
        <RowMenu label={`${entry.label} actions`} items={items} />
      ) : (
        <span className="plugins-row-spacer" aria-hidden="true" />
      )}
    </li>
  );
}

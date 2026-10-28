import { AgentMark, StatusDot } from "@auracode/ui/graphite";
import { ArrowUpRight, Ellipsis } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  AgentAuthStatus,
  AgentConnection,
  AgentConnections,
  AgentEntry,
  AgentInstallation,
  AgentMaintenance,
} from "../../bindings";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { harnessText } from "../../lib/plugins/format";
import { Row } from "../settings/SettingsRow";
import { TerminalSheet } from "../TerminalSheet";
import "../settings/settings.css";
import { AgentInstallations } from "./AgentInstallations";
import { InstallAgent } from "./InstallAgent";

// External help links are presentation content. Rust still owns every install/update command.
// Sources checked 2026-10-26; no shell instructions are synthesized from executable names. One
// entry per agent: an adapter or a text fallback is a connection of its agent, not a row.
const INSTALL_GUIDES: Readonly<Record<string, string>> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://developers.openai.com/codex/cli",
  pi: "https://pi.dev/docs/latest/quickstart",
  cursor: "https://cursor.com/docs/cli/installation",
  grok: "https://docs.x.ai/build/overview",
  omp: "https://github.com/can1357/oh-my-pi",
  opencode: "https://opencode.ai/docs",
  antigravity: "https://antigravity.google/download",
  hermes: "https://hermes-agent.nousresearch.com/docs/getting-started/installation",
};

/** A connection that cannot run here: offered disabled, unless it is already the choice. */
export function connectionUnavailable(option: AgentConnection): boolean {
  return option.availability.state === "missing" || option.availability.state === "broken";
}

/** Automatic's option, naming the connection it uses now. */
export function automaticChoice(connections: AgentConnections): string {
  const active = connections.options.find((option) => option.id === connections.active);
  return active ? `Automatic (${active.label})` : "Automatic";
}

/**
 * The Connection row's one line: what Automatic does and that chats keep theirs, then the adapter's
 * one-time download when the connection in use needs it (its install lives here, not in a row).
 */
export function connectionDetail(connections: AgentConnections): string {
  const line = "Automatic uses the first that can run here. A chat keeps the one it started with.";
  const used = connections.options.find(
    (option) => option.id === (connections.preferred ?? connections.active),
  );
  return used?.needs_download
    ? `${line} The ${used.label} downloads once, with its first chat.`
    : line;
}

/**
 * An agent's Connection setting, for an agent auracode can run more than one way (Claude Code's
 * own protocol or its ACP adapter). Automatic is the default; the choice applies to new sessions.
 */
export function ConnectionSetting({
  agent,
  connections,
  onConnection,
  onError,
}: {
  readonly agent: AgentEntry;
  readonly connections: AgentConnections;
  readonly onConnection: (agentId: string, connection: string | null) => Promise<void>;
  readonly onError: (message: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="settings-group agent-connection" data-testid="agent-connection">
      <Row title="Connection" detail={connectionDetail(connections)}>
        <select
          className="g-select settings-control settings-select"
          aria-label={`${agent.name} connection`}
          data-test-agent={agent.id}
          value={connections.preferred ?? ""}
          disabled={saving}
          onChange={(event) => {
            const value = event.currentTarget.value || null;
            setSaving(true);
            onError(null);
            onConnection(agent.id, value)
              .catch((reason) => onError(errorMessage(reason)))
              .finally(() => setSaving(false));
          }}
        >
          <option value="">{automaticChoice(connections)}</option>
          {connections.options.map((option) => (
            <option
              key={option.id}
              value={option.id}
              disabled={connectionUnavailable(option) && option.id !== connections.preferred}
            >
              {option.label}
            </option>
          ))}
        </select>
      </Row>
    </div>
  );
}

/**
 * The agents Rust can install with one reviewed, version-pinned npm command. The rest keep their
 * guide, each for its reason in docs/setup-actions.md.
 */
const ONE_CLICK = ["claude", "codex", "pi", "opencode", "grok"];

/** Where detection stands for one agent, as the row shows it. */
export type AgentPhase = "checking" | "ready" | "signin" | "missing" | "broken";

const STATUS: Record<AgentPhase, string> = {
  checking: "Looking",
  ready: "Installed",
  signin: "Needs sign-in",
  missing: "Not installed",
  broken: "Unavailable",
};

export function agentPhase(agent: AgentEntry, auth: AgentAuthStatus | null = null): AgentPhase {
  switch (agent.availability.state) {
    case "checking":
      return "checking";
    case "missing":
      return "missing";
    case "broken":
      return "broken";
    case "ready":
      return auth?.state === "sign_in_required" ? "signin" : "ready";
  }
}

function channelLabel(installation: AgentInstallation): string {
  const channel = installation.channel;
  const label =
    channel.type === "npm"
      ? "npm"
      : channel.type === "homebrew"
        ? "Homebrew"
        : channel.type === "vendor_standalone"
          ? "Standalone"
          : channel.type === "bundled"
            ? `Managed by ${channel.application}`
            : "Unknown channel";
  return installation.host.type === "wsl" ? `${label} in WSL ${installation.host.distro}` : label;
}

function authText(status: AgentAuthStatus): string {
  switch (status.state) {
    case "credentials_present":
      return "Signed in. The agent confirms access when it runs.";
    case "sign_in_required":
      return "Sign in with the agent's own login.";
    case "unknown":
      return status.reason;
    case "unsupported":
      return "This agent cannot report its sign-in.";
  }
}

/** "2026-10-26" as "Oct 26, 2026"; anything else as given. */
export function verifiedDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A newer release is known and the installed version does not mention it. */
function newerRelease(agent: AgentEntry): string | null {
  // Rust compares versions when detection supplied a harness status.
  if (agent.harness)
    return agent.harness.state === "update_available" ? agent.harness.latest : null;
  const latest = agent.latest_release?.version;
  if (!latest || agent.availability.state !== "ready") return null;
  const installed = agent.installation?.version ?? agent.availability.version ?? "";
  return installed.includes(latest) ? null : latest;
}

interface MenuItem {
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
  readonly separator?: boolean;
}

/**
 * The row's kebab: plain rows and at most one divider (Vercel's project menu). It owns the
 * keyboard while open: arrows move, Home and End jump, Escape and Tab close and return focus.
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
    const height = menu.current?.offsetHeight ?? 0;
    const below = box.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({
      top: below ? box.bottom + 4 : Math.max(8, box.top - 4 - height),
      right: Math.max(8, window.innerWidth - box.right),
    });
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  });
  const move = (event: React.KeyboardEvent) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => entries[(index + entries.length) % entries.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(entries.length - 1);
    else if (event.key === "Escape") close();
    // Tab leaves from the trigger, so focus continues to the next row instead of the page's end.
    else if (event.key === "Tab") close();
    else return;
    if (event.key !== "Tab") event.preventDefault();
    event.stopPropagation();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="g-button g-button-ghost g-button-icon g-button-28 agent-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              className="g-root g-menu agent-menu"
              style={place}
              onKeyDown={move}
            >
              {items.map((item) =>
                item.separator ? (
                  <hr key={`${item.label}-separator`} className="g-menu-separator" />
                ) : item.href ? (
                  <a
                    key={item.label}
                    role="menuitem"
                    tabIndex={-1}
                    className="g-menu-item"
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => close()}
                  >
                    {item.label}
                    <ArrowUpRight className="agent-menu-out" size={14} aria-hidden="true" />
                  </a>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="g-menu-item"
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            // Into the page's landmark, so the menu belongs to it; fixed, so the list cannot clip it.
            trigger.current?.closest("main") ?? document.body,
          )
        : null}
    </>
  );
}

/**
 * One agent as a row (Vercel's project list): its mark, name and version, what detection found,
 * the date auracode last verified the integration, one action and a menu for the rest. Choosing the
 * row opens its details: what it is, where it runs from and which executable it uses.
 *
 * Actions are offered only when Rust verifies the exact detected installation supports them, and
 * nothing runs until it is chosen: sign-in status is checked only when asked.
 */
export function AgentRow({
  agent,
  transport,
  onRefresh,
  onConnection,
  compact = false,
  index = 0,
}: {
  readonly agent: AgentEntry;
  readonly transport: Transport;
  readonly onRefresh: () => void;
  /** The Agents page: the details offer the Connection setting of an agent with several. */
  readonly onConnection?: (agentId: string, connection: string | null) => Promise<void>;
  /** Setup's roster: no date or menu on the row; the actions sit in the details. */
  readonly compact?: boolean;
  readonly index?: number;
}) {
  const ready = agent.availability.state === "ready";
  const installKey = `${agent.installation?.launch_path ?? ""}:${agent.installation?.version ?? ""}`;
  const [open, setOpen] = useState(false);
  const [maintenance, setMaintenance] = useState<AgentMaintenance | null>(null);
  const [auth, setAuth] = useState<AgentAuthStatus | null>(null);
  const [busy, setBusy] = useState<"auth" | "update" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different installation needs its own lookup.
  useEffect(() => {
    setMaintenance(null);
    setAuth(null);
    setMessage(null);
    setError(null);
    if (!ready) return;
    let live = true;
    void transport.agentMaintenance(agent.id).then(
      (value) => {
        if (live) setMaintenance(value);
      },
      (reason) => {
        if (live) setError(errorMessage(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [transport, agent.id, ready, installKey]);
  const run = async (kind: "auth" | "update", action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };
  const checkSignIn = () =>
    void run("auth", async () => {
      const status = await transport.agentAuthStatus(agent.id);
      setAuth(status);
      setMessage(authText(status));
    });
  const update = () =>
    void run("update", async () => {
      await transport.agentUpdate(agent.id);
      setMessage("Update finished.");
      onRefresh();
    });
  const phase = agentPhase(agent, auth);
  const guide = INSTALL_GUIDES[agent.id];
  const newer = newerRelease(agent);
  const canUpdate = maintenance?.update_unavailable === null;
  const canSignIn = maintenance?.login_available === true;
  const installable = agent.availability.state === "missing" && ONE_CLICK.includes(agent.id);
  // One action at most, and only Install, Update or Sign in: a guide link is not an action here.
  const primary: "install" | "update" | "signin" | null =
    phase === "missing" || phase === "broken"
      ? installable
        ? "install"
        : null
      : phase === "checking"
        ? null
        : canUpdate && newer
          ? "update"
          : phase === "signin" && canSignIn
            ? "signin"
            : null;
  const disabled = busy !== null;
  const primaryButton =
    primary === "install" ? (
      <InstallAgent
        agentId={agent.id}
        agentName={agent.name}
        onRefresh={onRefresh}
        label="Install"
        ariaLabel={`Install ${agent.name}`}
        className="g-button g-button-outline g-button-28"
        onError={setError}
      />
    ) : primary === "update" ? (
      <button
        type="button"
        className="g-button g-button-outline g-button-28"
        disabled={disabled}
        aria-label={`Update ${agent.name}`}
        onClick={update}
      >
        {busy === "update" ? "Updating…" : "Update"}
      </button>
    ) : primary === "signin" ? (
      <button
        type="button"
        className="g-button g-button-outline g-button-28"
        disabled={disabled}
        aria-label={`Sign in to ${agent.name}`}
        onClick={() => setSignIn(true)}
      >
        Sign in
      </button>
    ) : null;
  // The rest of what the agent can do, in the order people reach for it.
  const actions: MenuItem[] = [];
  if (canSignIn && primary !== "signin")
    actions.push({ label: "Sign in…", onSelect: () => setSignIn(true) });
  if (maintenance?.auth_status)
    actions.push({
      label: busy === "auth" ? "Checking sign-in…" : "Check sign-in",
      onSelect: checkSignIn,
    });
  if (canUpdate && primary !== "update") actions.push({ label: "Update", onSelect: update });
  const links: MenuItem[] = [];
  if (guide) links.push({ label: "Installation guide", href: guide });
  if (agent.installation) {
    const path = agent.installation.launch_path;
    links.push({
      label: "Copy path",
      onSelect: () =>
        void navigator.clipboard.writeText(path).then(
          () => setMessage("Path copied."),
          () => setError("Could not copy the path. Select it in the details instead."),
        ),
    });
  }
  const items = [
    ...actions,
    ...(actions.length && links.length ? [{ label: "links", separator: true }] : []),
    ...links,
  ];
  const version = ready
    ? ((agent.availability.state === "ready" ? agent.availability.version : null) ?? "Built in")
    : null;
  const style = { "--g-row-index": index } as CSSProperties;
  return (
    <li
      className="agent-row g-enter"
      data-phase={phase}
      data-open={open || undefined}
      style={style}
    >
      <div className="agent-row-main">
        <button
          type="button"
          className="agent-row-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {/* The name and status beside the mark say what it shows. */}
          <span className="agent-row-mark" aria-hidden="true">
            <AgentMark
              agent={agent.id}
              size={compact ? 24 : 32}
              state={phase === "checking" ? "thinking" : "idle"}
              ghost={phase === "missing" || phase === "broken"}
            />
          </span>
          <span className="agent-row-name">
            <strong>{agent.name}</strong>
            {version ? (
              <small className="agent-row-version" key={version}>
                {version}
              </small>
            ) : null}
          </span>
          <span className="agent-row-status" data-phase={phase} key={phase}>
            <span className="agent-row-dot" aria-hidden="true">
              {phase === "ready" ? (
                <StatusDot tone="green" />
              ) : phase === "signin" ? (
                <StatusDot tone="volt" />
              ) : phase === "broken" ? (
                <StatusDot tone="red" />
              ) : phase === "missing" ? (
                <span className="agent-row-hollow" />
              ) : null}
            </span>
            <span>{STATUS[phase]}</span>
          </span>
          {compact ? null : (
            <span
              className="agent-row-verified"
              title={`Last verified: ${verifiedDate(agent.last_verified)}`}
            >
              <span className="sr-only">Verified </span>
              {verifiedDate(agent.last_verified)}
            </span>
          )}
        </button>
        {compact ? null : (
          <div className="agent-row-actions">
            {primaryButton}
            {items.length ? (
              <RowMenu label={`${agent.name} actions`} items={items} />
            ) : (
              <span className="agent-menu-spacer" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
      {!compact && agent.harness?.state === "update_available" ? (
        <p className="agent-row-update" role="status">
          <StatusDot tone="volt" />
          <span>{harnessText(agent.name, agent.harness)}</span>
        </p>
      ) : null}
      {message || error || busy ? (
        <p
          className="agent-row-note"
          role={error ? "alert" : "status"}
          data-error={error ? true : undefined}
        >
          {error ??
            (busy === "auth" ? "Checking sign-in…" : busy === "update" ? "Updating…" : message)}
        </p>
      ) : null}
      {open ? (
        <AgentDetail
          agent={agent}
          maintenance={maintenance}
          onRefresh={onRefresh}
          onConnection={onConnection}
          onError={setError}
        >
          {compact && (primaryButton || items.length) ? (
            <div className="agent-detail-actions">
              {primaryButton}
              {items
                .filter((item) => !item.separator)
                .map((item) =>
                  item.href ? (
                    <a
                      key={item.label}
                      className="g-button g-button-ghost g-button-28 agent-guide"
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.label} <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      disabled={disabled}
                      onClick={item.onSelect}
                    >
                      {item.label}
                    </button>
                  ),
                )}
            </div>
          ) : null}
        </AgentDetail>
      ) : null}
      {signIn ? (
        <TerminalSheet
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => {
            setSignIn(false);
            onRefresh();
          }}
          onFinished={() => setMessage("Sign-in finished. Check sign-in to confirm access.")}
        />
      ) : null}
    </li>
  );
}

function AgentDetail({
  agent,
  maintenance,
  onRefresh,
  onConnection,
  onError,
  children,
}: {
  readonly agent: AgentEntry;
  readonly maintenance: AgentMaintenance | null;
  readonly onRefresh: () => void;
  readonly onConnection?: (agentId: string, connection: string | null) => Promise<void>;
  readonly onError: (message: string | null) => void;
  readonly children?: ReactNode;
}) {
  const reason =
    agent.availability.state === "missing" || agent.availability.state === "broken"
      ? agent.availability.reason
      : null;
  const installation = agent.installation;
  const release = agent.latest_release;
  return (
    <div className="agent-detail">
      <p className="agent-detail-lead">{agent.description}</p>
      {reason ? <p className="agent-detail-reason">{reason}</p> : null}
      <dl className="agent-facts">
        {installation ? (
          <>
            <dt>Runs from</dt>
            <dd>
              <code>{installation.launch_path}</code>
            </dd>
            <dt>Installed with</dt>
            <dd>{channelLabel(installation)}</dd>
          </>
        ) : null}
        {agent.harness ? (
          <>
            <dt>Updates</dt>
            <dd>{harnessText(agent.name, agent.harness)}</dd>
          </>
        ) : null}
        {release?.version ? (
          <>
            <dt>Latest release</dt>
            <dd>
              <code>{release.version}</code>
              {release.stale ? <span className="agent-facts-aside"> · cached</span> : null}
            </dd>
          </>
        ) : null}
        {maintenance?.update_unavailable ? (
          <>
            <dt>Updates</dt>
            <dd>{maintenance.update_unavailable}</dd>
          </>
        ) : null}
        <dt>Verified</dt>
        <dd>
          {verifiedDate(agent.last_verified)}
          <span className="agent-facts-aside">
            {" "}
            · for the listed integration; a newer release may differ
          </span>
        </dd>
      </dl>
      {onConnection && agent.connections ? (
        <ConnectionSetting
          agent={agent}
          connections={agent.connections}
          onConnection={onConnection}
          onError={onError}
        />
      ) : null}
      {children}
      {agent.id !== "demo" ? <AgentInstallations agentId={agent.id} onChanged={onRefresh} /> : null}
    </div>
  );
}

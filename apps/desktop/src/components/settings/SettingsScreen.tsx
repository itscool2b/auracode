import { Keycap, Logo } from "@auracode/ui/graphite";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CircleUser,
  Info,
  Keyboard,
  LibraryBig,
  type LucideIcon,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import type { AppInfo, MotionPreference, SetupSnapshot } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { revealDataDir } from "../../lib/ipc";
import { type SetupApi, setMotionPreference, setupApi } from "../../lib/setup";
import { type UpdatesApi, updatesApi } from "../../lib/updates";
import { AccountPanel } from "./AccountPanel";
import { ConfigSyncPanel } from "./ConfigSyncPanel";
import { LocalImportPanel } from "./LocalImportPanel";
import { NoticesDialog } from "./NoticesDialog";
import { ProfilePicker } from "./ProfilePicker";
import { UpdatePanel } from "./UpdatePanel";
import "./settings.css";

type Page = "general" | "account" | "configuration" | "shortcuts" | "about";
const PAGES: readonly (readonly [Page, string, LucideIcon])[] = [
  ["general", "General", SlidersHorizontal],
  ["account", "Account", CircleUser],
  ["configuration", "Configuration sync", RefreshCcw],
  ["shortcuts", "Shortcuts", Keyboard],
  ["about", "About", Info],
];

/** A settings row: the label, an optional one-line description, and at most one control. */
export function Row({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div>
          <strong>{title}</strong>
          {detail ? <p>{detail}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/** One keycap per key in a chord; a repeated key shows twice. */
function Keys({ keys, mac }: { readonly keys: string; readonly mac: boolean }) {
  const names: Record<string, string> = {
    "⌘": "Command",
    "⇧": "Shift",
    "↑": "Up arrow",
    "↓": "Down arrow",
  };
  const caps = keys === "Esc again" ? ["Esc", "Esc"] : keys.split(" ");
  return (
    <span className="settings-keys">
      {caps.map((key, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chord can repeat a key, so position is its identity.
        <Fragment key={index}>
          <Keycap label={names[key]}>{mac && key === "Shift" ? "⇧" : key}</Keycap>
        </Fragment>
      ))}
    </span>
  );
}

function General({
  info,
  api,
  onSetup,
  reveal,
}: {
  readonly info: AppInfo;
  readonly api: SetupApi;
  readonly onSetup: () => void;
  readonly reveal: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<SetupSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    void reload;
    mounted.current = true;
    let live = true;
    api.snapshot().then(
      (next) => {
        if (live) {
          setSaved(next);
          setError(null);
        }
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [api, reload]);
  const motion = async (value: MotionPreference) => {
    if (!saved || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await api.apply(saved.preferences.revision, { type: "motion", value });
      setMotionPreference(next.preferences.motion);
      if (mounted.current) setSaved(next);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-group">
        <Row title="Motion" detail="Full still follows your system's reduced motion setting.">
          <fieldset className="settings-segmented settings-control" disabled={!saved || busy}>
            <legend className="sr-only">Motion</legend>
            {(["full", "reduced", "off"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="settings-motion"
                  value={value}
                  checked={saved?.preferences.motion === value}
                  onChange={() => void motion(value)}
                />
                <span>{value === "full" ? "Full" : value === "reduced" ? "Reduced" : "Off"}</span>
              </label>
            ))}
          </fieldset>
        </Row>
        <Row title="Welcome and setup" detail="Review your agents and pick a first project again.">
          <button className="g-button g-button-outline g-button-28" type="button" onClick={onSetup}>
            Run setup
          </button>
        </Row>
        <Row
          title="Data folder"
          detail={
            info.data_dir ? (
              <span className="settings-mono">{info.data_dir}</span>
            ) : (
              "Chats stay on this device."
            )
          }
        >
          <button
            className="g-button g-button-outline g-button-28"
            type="button"
            disabled={!info.data_dir}
            onClick={() => void reveal().catch((failure) => setError(errorMessage(failure)))}
          >
            Open folder
          </button>
        </Row>
      </div>
      {saved?.notice ? <p className="settings-footnote">{saved.notice}</p> : null}
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          <button
            className="g-button g-button-28"
            type="button"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload preferences
          </button>
        </div>
      ) : null}
    </>
  );
}

export function SettingsScreen({
  info,
  onBack,
  onAgents,
  onLibrary,
  onSetup,
  onDiagnostics,
  onImported,
  setup = setupApi,
  updates = updatesApi,
  reveal = revealDataDir,
  initialPage = "general",
  navigationId = "settings",
  initialEmail = "",
  backLabel = "Back to chats",
}: {
  readonly info: AppInfo;
  readonly onBack: () => void;
  readonly onAgents: () => void;
  readonly onLibrary?: () => void;
  readonly onSetup: () => void;
  readonly onDiagnostics: () => void;
  readonly onImported?: () => Promise<void>;
  readonly setup?: SetupApi;
  readonly updates?: UpdatesApi;
  readonly reveal?: () => Promise<void>;
  readonly initialPage?: Page;
  readonly navigationId?: string;
  readonly initialEmail?: string;
  readonly backLabel?: string;
}) {
  const [page, setPage] = useState<Page>(initialPage);
  const [notices, setNotices] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void navigationId;
    // A new website link selects Account without destroying an existing code/key setup.
    setPage(initialPage);
  }, [navigationId, initialPage]);
  useEffect(() => {
    const previous = document.activeElement;
    heading.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      });
    };
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        event.preventDefault();
        onBack();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [onBack]);
  const open = (next: Page) => {
    setPage(next);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const mac = info.os === "macos";
  const key = mac ? "⌘" : "Ctrl";
  const shortcuts = [
    ["New chat", `${key} N`],
    ["Search chats, projects and files", `${key} K`],
    ["Open context panel", `${key} J`],
    ["Choose agent, model and effort", `${key} .`],
    ["Open settings", `${key} ,`],
    ["Send message", "Enter"],
    ["New line", "Shift Enter"],
    ["Interrupt agent", "Esc"],
    ["Force stop after interrupt", "Esc again"],
    ["Move through a menu", "↑ ↓"],
    ["Close a menu or dialog", "Esc"],
  ];
  const title = PAGES.find(([value]) => value === page)?.[1] ?? "";
  return (
    <div className="settings-shell g-root" data-os={info.os}>
      <aside className="settings-sidebar" aria-label="Settings navigation">
        <div className="settings-drag" data-tauri-drag-region="" />
        <Logo size={24} className="settings-logo" />
        <button type="button" className="settings-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
        </button>
        <h2>Settings</h2>
        <nav>
          {PAGES.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-current={page === value ? "page" : undefined}
              onClick={() => open(value)}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="settings-nav-label">{label}</span>
            </button>
          ))}
          <hr />
          <button type="button" onClick={onAgents}>
            <Bot size={16} aria-hidden="true" />
            <span className="settings-nav-label">Agents</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
          {onLibrary ? (
            <button type="button" onClick={onLibrary}>
              <LibraryBig size={16} aria-hidden="true" />
              <span className="settings-nav-label">Library</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : null}
        </nav>
      </aside>
      <main className="settings-main">
        <div className="settings-drag" data-tauri-drag-region="" />
        <div className="settings-content">
          {page === "about" ? (
            <header className="settings-identity">
              <Logo size={40} />
              <div>
                <h1 ref={heading} tabIndex={-1}>
                  <span className="sr-only">About </span>auracode
                </h1>
                <p>Version {info.app_version}</p>
              </div>
            </header>
          ) : (
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
          )}
          {page === "general" ? (
            <General info={info} api={setup} onSetup={onSetup} reveal={reveal} />
          ) : null}
          {page === "account" ? (
            <>
              <ProfilePicker activeId={info.profile?.id ?? null} />
              <AccountPanel
                initialEmail={initialEmail}
                deviceName={info.device?.name ?? "My computer"}
                activeProfileId={info.profile?.id ?? null}
              />
              {info.profile?.kind === "account" && !info.profile_locked && onImported ? (
                <LocalImportPanel key={info.profile.id} onImported={onImported} />
              ) : null}
            </>
          ) : null}
          {page === "configuration" ? (
            <ConfigSyncPanel
              profileId={info.profile?.id ?? null}
              active={info.profile?.kind === "account" && !info.profile_locked}
              onAccount={() => open("account")}
            />
          ) : null}
          {page === "shortcuts" ? (
            <dl className="settings-group settings-shortcuts">
              {shortcuts.map(([action, keys]) => (
                <div key={action}>
                  <dt>{action}</dt>
                  <dd>
                    <Keys keys={keys ?? ""} mac={mac} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {page === "about" ? (
            <>
              <div className="settings-group">
                <UpdatePanel api={updates} />
                <Row
                  title="This device"
                  detail={
                    <>
                      {info.os === "macos" ? "macOS" : "Windows"} {info.os_version} ·{" "}
                      <span className="settings-mono">{info.arch}</span>
                    </>
                  }
                />
                <Row title="Diagnostics" detail="Startup details and local troubleshooting tools.">
                  <button
                    className="g-button g-button-outline g-button-28"
                    type="button"
                    onClick={onDiagnostics}
                  >
                    Open
                  </button>
                </Row>
                <Row
                  title="Third-party notices"
                  detail="Licenses for the open source software inside auracode."
                >
                  <button
                    className="g-button g-button-outline g-button-28"
                    type="button"
                    onClick={() => setNotices(true)}
                  >
                    View
                  </button>
                </Row>
              </div>
              {notices ? <NoticesDialog onClose={() => setNotices(false)} /> : null}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

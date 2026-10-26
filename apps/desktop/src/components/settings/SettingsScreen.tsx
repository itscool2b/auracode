import { OrbitMark } from "@auracode/ui/orbit";
import { ArrowLeft, ArrowUpRight, FolderOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
const TITLES: Record<Page, readonly [string, string]> = {
  general: ["General", "Your workspace. At your pace."],
  account: ["Account", "Your work, across your devices."],
  configuration: ["Configuration sync", "Bring your setup with you."],
  shortcuts: ["Shortcuts", "Keep your hands on the keyboard."],
  about: ["About auracode", "One window for your agents."],
};

function Row({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {children}
    </div>
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
      <section className="settings-section">
        <h2>Workspace</h2>
        <div className="settings-group">
          <Row
            title="Interface motion"
            detail="Full motion still respects reduced motion on your device."
          >
            <fieldset className="settings-segmented" disabled={!saved || busy}>
              <legend className="settings-sr-only">Interface motion</legend>
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
          <Row
            title="Welcome and setup"
            detail="Review your agents and choose your first project again."
          >
            <button className="ui-button" type="button" onClick={onSetup}>
              Run setup
            </button>
          </Row>
        </div>
        {saved?.notice ? <p className="settings-footnote">{saved.notice}</p> : null}
      </section>
      <section className="settings-section">
        <h2>Local storage</h2>
        <div className="settings-group">
          <Row
            title="Your data"
            detail="Chats stay on this device. No account is needed for local work."
          >
            <button
              className="ui-button"
              type="button"
              disabled={!info.data_dir}
              onClick={() => void reveal().catch((failure) => setError(errorMessage(failure)))}
            >
              <FolderOpen size={14} /> Open folder
            </button>
          </Row>
          {info.data_dir ? <p className="settings-path">{info.data_dir}</p> : null}
        </div>
      </section>
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          <button
            className="ui-button"
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
  const key = info.os === "macos" ? "⌘" : "Ctrl";
  const shortcuts = [
    ["Open settings", `${key} ,`],
    ["Search chats, projects and files", `${key} K`],
    ["Open context panel", `${key} J`],
    ["Choose agent, model and effort", `${key} .`],
    ["Send message", "Enter"],
    ["New line", "Shift Enter"],
    ["Interrupt agent", "Esc"],
    ["Force stop after interrupt", "Esc again"],
  ];
  return (
    <div className="settings-shell orbit-theme" data-theme="dark">
      <aside className="settings-sidebar" aria-label="Settings navigation">
        <div className="chat-drag" data-tauri-drag-region="" />
        <button type="button" className="settings-back" onClick={onBack}>
          <ArrowLeft size={15} /> {backLabel}
        </button>
        <h2>Settings</h2>
        <nav>
          {(["general", "account", "configuration", "shortcuts", "about"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-current={page === value ? "page" : undefined}
              onClick={() => {
                setPage(value);
                requestAnimationFrame(() => heading.current?.focus());
              }}
            >
              {value === "about" ? "About" : TITLES[value][0]}
            </button>
          ))}
          <button type="button" onClick={onAgents}>
            Agents <ArrowUpRight size={13} />
          </button>
          {onLibrary ? (
            <button type="button" onClick={onLibrary}>
              Library <ArrowUpRight size={13} />
            </button>
          ) : null}
        </nav>
        <div className="settings-identity">
          <OrbitMark agent="claude" size={25} />
          <span>
            auracode<small>{info.app_version}</small>
          </span>
        </div>
      </aside>
      <main className="settings-main">
        <div className="chat-drag" data-tauri-drag-region="" />
        <div className="settings-content">
          <header>
            <h1 ref={heading} tabIndex={-1}>
              {TITLES[page][0]}
            </h1>
            <p>{TITLES[page][1]}</p>
          </header>
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
              onAccount={() => {
                setPage("account");
                requestAnimationFrame(() => heading.current?.focus());
              }}
            />
          ) : null}
          {page === "shortcuts" ? (
            <section className="settings-section">
              <h2>Everyday actions</h2>
              <dl className="settings-group settings-shortcuts">
                {shortcuts.map(([title, keys]) => (
                  <div key={title}>
                    <dt>{title}</dt>
                    <dd>
                      <kbd>{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="settings-footnote">
                Menus also support arrow keys, Enter and Escape. Shortcuts respect open dialogs and
                active text composition.
              </p>
            </section>
          ) : null}
          {page === "about" ? (
            <>
              <section className="settings-section">
                <h2>Application</h2>
                <div className="settings-group">
                  <Row title="auracode" detail={`Version ${info.app_version}`} />
                  <Row
                    title="This device"
                    detail={`${info.os === "macos" ? "macOS" : "Windows"} ${info.os_version} · ${info.arch}`}
                  />
                  <Row
                    title="Diagnostics"
                    detail="Startup information and local troubleshooting tools."
                  >
                    <button className="ui-button" type="button" onClick={onDiagnostics}>
                      Open
                    </button>
                  </Row>
                  <Row
                    title="Third-party notices"
                    detail="Licenses for the open source software included in auracode."
                  >
                    <button className="ui-button" type="button" onClick={() => setNotices(true)}>
                      View
                    </button>
                  </Row>
                </div>
              </section>
              {notices ? <NoticesDialog onClose={() => setNotices(false)} /> : null}
              <UpdatePanel api={updates} />
              <p className="settings-footnote">
                Your installed agents keep their own accounts and credentials.
              </p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

import { Keycap, Logo } from "@auracode/ui/graphite";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CircleUser,
  FileText,
  Info,
  Keyboard,
  type LucideIcon,
  Puzzle,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AppInfo, InstructionsTarget } from "../../bindings";
import type { DataCleanupApi } from "../../lib/dataCleanup";
import { GLOBAL, type InstructionsApi, instructionsApi } from "../../lib/instructions";
import { revealDataDir } from "../../lib/ipc";
import { type GeneralApi, generalApi, type SetupApi, setupApi } from "../../lib/setup";
import { type UpdatesApi, updatesApi } from "../../lib/updates";
import { AccountPanel } from "./AccountPanel";
import { ConfigSyncPanel } from "./ConfigSyncPanel";
import { DeleteDataDialog } from "./DeleteDataDialog";
import { GeneralPanel } from "./GeneralPanel";
import { type InstructionsFolder, InstructionsPanel } from "./InstructionsPanel";
import { LocalImportPanel } from "./LocalImportPanel";
import { NoticesDialog } from "./NoticesDialog";
import { ProfilePicker } from "./ProfilePicker";
import { Row } from "./SettingsRow";
import { UpdatePanel } from "./UpdatePanel";
import "./settings.css";

export { Row } from "./SettingsRow";

export type Page = "general" | "instructions" | "account" | "configuration" | "shortcuts" | "about";
const PAGES: readonly (readonly [Page, string, LucideIcon])[] = [
  ["general", "General", SlidersHorizontal],
  ["instructions", "Instructions", FileText],
  ["account", "Account", CircleUser],
  ["configuration", "Configuration sync", RefreshCcw],
  ["shortcuts", "Shortcuts", Keyboard],
  ["about", "About", Info],
];

/** One keycap per key in a chord; a repeated key shows twice. */
function Keys({ keys, mac }: { readonly keys: string; readonly mac: boolean }) {
  const names: Record<string, string> = {
    "⌘": "Command",
    "⇧": "Shift",
    "↑": "Up arrow",
    "↓": "Down arrow",
    "1–9": "1 to 9",
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

export function SettingsScreen({
  info,
  onBack,
  onAgents,
  onLibrary,
  onSetup,
  onDiagnostics,
  onImported,
  setup = setupApi,
  general = generalApi,
  updates = updatesApi,
  reveal = revealDataDir,
  initialPage = "general",
  navigationId = "settings",
  initialEmail = "",
  backLabel = "Back to chats",
  instructions = instructionsApi,
  instructionsTarget = GLOBAL,
  instructionFolders = [],
  chatLabel,
  instructionsOpenOnLoad,
  dataCleanup,
  deleteDataOpenOnLoad = false,
}: {
  readonly info: AppInfo;
  readonly onBack: () => void;
  readonly onAgents: () => void;
  readonly onLibrary?: () => void;
  readonly onSetup: () => void;
  readonly onDiagnostics: () => void;
  readonly onImported?: () => Promise<void>;
  readonly setup?: SetupApi;
  readonly general?: GeneralApi;
  readonly updates?: UpdatesApi;
  readonly reveal?: () => Promise<void>;
  readonly initialPage?: Page;
  readonly navigationId?: string;
  readonly initialEmail?: string;
  readonly backLabel?: string;
  readonly instructions?: InstructionsApi;
  /** The scope Instructions opens on: global, a project folder, or a chat's own folder. */
  readonly instructionsTarget?: InstructionsTarget;
  readonly instructionFolders?: readonly InstructionsFolder[];
  readonly chatLabel?: string;
  /** Development previews only (see InstructionsPanel). */
  readonly instructionsOpenOnLoad?: Parameters<typeof InstructionsPanel>[0]["openOnLoad"];
  /** "Delete all auracode data"; previews pass a synthetic one. */
  readonly dataCleanup?: DataCleanupApi;
  /** Development previews only: About opens with the review already showing. */
  readonly deleteDataOpenOnLoad?: boolean;
}) {
  const [page, setPage] = useState<Page>(initialPage);
  const [notices, setNotices] = useState(false);
  const [deleting, setDeleting] = useState(deleteDataOpenOnLoad);
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
    ["Open chat 1 to 9 in the sidebar", `${key} 1–9`],
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
              <Puzzle size={16} aria-hidden="true" />
              <span className="settings-nav-label">Plugin library</span>
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
            <GeneralPanel
              info={info}
              api={setup}
              general={general}
              onSetup={onSetup}
              reveal={reveal}
            />
          ) : null}
          {page === "instructions" ? (
            <InstructionsPanel
              api={instructions}
              initialTarget={instructionsTarget}
              folders={instructionFolders}
              chatLabel={chatLabel}
              openOnLoad={instructionsOpenOnLoad}
            />
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
              <section className="settings-section" aria-labelledby="settings-this-device">
                <h2 id="settings-this-device">This device</h2>
                <div className="settings-group">
                  <Row
                    title={info.os === "macos" ? "macOS" : "Windows"}
                    detail={
                      <>
                        {info.os_version} · <span className="settings-mono">{info.arch}</span>
                      </>
                    }
                  />
                  <Row
                    title="Delete all auracode data"
                    detail="Chats, settings, keys and worktrees, as if auracode was never installed. Your agents and repositories stay."
                  >
                    <button
                      className="g-button g-button-outline g-button-28"
                      type="button"
                      data-testid="settings-delete-data"
                      onClick={() => setDeleting(true)}
                    >
                      Review
                    </button>
                  </Row>
                </div>
              </section>
              {notices ? <NoticesDialog onClose={() => setNotices(false)} /> : null}
              {deleting ? (
                <DeleteDataDialog api={dataCleanup} onClose={() => setDeleting(false)} />
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

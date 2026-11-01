import type { AgentBrandId, OrbState } from "@auracode/ui";
import { MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AppInfo, InstructionsTarget, StressConfig } from "./bindings";
import { ChatsScreen } from "./components/chat/ChatsScreen";
import { CustomizeScreen, type CustomizeSection } from "./components/customize/CustomizeScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { Home } from "./components/Home";
import { Sidebar } from "./components/Sidebar";
import { StressView } from "./components/StressView";
import { AccountPanel } from "./components/settings/AccountPanel";
import {
  ConfigurationRecovery,
  recoverProfileConfiguration,
} from "./components/settings/ConfigurationRecovery";
import { LockedProfile } from "./components/settings/LockedProfile";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { AgentsScreen } from "./components/setup/AgentsScreen";
import { Onboarding } from "./components/setup/Onboarding";
import { subscribeAccountSync } from "./lib/account/sync";
import type { AppStore } from "./lib/chat/appStore";
import type { Transport } from "./lib/chat/transport";
import { errorMessage } from "./lib/errors";
import { useStream } from "./lib/hooks";
import { getAppInfo, inTauri, sendSmokeReport, windowReady } from "./lib/ipc";
import { subscribeNativeNavigation } from "./lib/nativeNavigation";
import { LATE_NOTICE_CHECKS_MS, withLateNotices } from "./lib/notices";
import { installProfileEvents, switchProfile } from "./lib/profiles";
import { afterPaint, whenPainted } from "./lib/ready";
import type { StreamStore } from "./lib/session";
import { signInNavigationReady, subscribeSignInLinks } from "./lib/signInLinks";
import { runSmoke, type SmokeHooks } from "./lib/smoke";
import { runChatSmoke } from "./lib/smokeChat";
import { activityOf } from "./lib/stream";
import { DEFAULT_STRESS } from "./lib/stress";
import type { WorkspaceStore } from "./lib/workspace";

type Boot =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly info: AppInfo }
  | { readonly status: "outside" }
  | { readonly status: "failed"; readonly message: string };

/** The chats (the default), the M0 home (the info card and the demo stream), or the stress view. */
type View = "chats" | "diagnostics" | "stress" | "setup" | "agents" | "settings" | "library";

/**
 * Switching views ends the current stream: the shell stops it (so it does not keep streaming into
 * a channel nobody reads) and the store forgets it (so the new view starts empty).
 */
function leaveStream(store: StreamStore): void {
  store
    .abandon()
    .catch((error: unknown) => console.error("auracode: could not stop the stream", error));
}

export function App({
  store,
  chats,
  transport,
  workspace,
}: {
  readonly store: StreamStore;
  readonly chats: AppStore;
  readonly transport: Transport;
  readonly workspace?: WorkspaceStore;
}) {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const [view, setView] = useState<View>("setup");
  const [restartSetup, setRestartSetup] = useState(false);
  const [customizeEntry, setCustomizeEntry] = useState<{
    id: number;
    section: CustomizeSection;
    projectId: string | null;
    target?: InstructionsTarget;
    chatLabel?: string;
    activeChatId?: string;
  }>({ id: 0, section: "plugins", projectId: null });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [settingsReturn, setSettingsReturn] = useState<"chats" | "setup">("chats");
  const [settingsEntry, setSettingsEntry] = useState<{
    id: string;
    page: "general" | "account" | "instructions";
    email: string;
    target?: InstructionsTarget;
    chatLabel?: string;
  }>({
    id: "initial",
    page: "general",
    email: "",
  });
  useEffect(
    () =>
      subscribeSignInLinks((link) => {
        const current = bootRef.current;
        if (
          !signInNavigationReady(
            current.status === "ready" ? current.info : null,
            !!document.querySelector(
              'dialog[open], [role="dialog"], #profile-transition, #root[inert]',
            ),
          )
        )
          return false;
        setSettingsReturn((previous) =>
          viewRef.current === "settings"
            ? previous
            : viewRef.current === "setup"
              ? "setup"
              : "chats",
        );
        setRestartSetup(false);
        setSettingsEntry({ id: link.id, page: "account", email: link.email ?? "" });
        setView("settings");
        return true;
      }),
    [],
  );
  const activeProfileId = boot.status === "ready" ? (boot.info.profile?.id ?? null) : null;
  useEffect(
    () =>
      subscribeAccountSync(activeProfileId, (status) => {
        if (status.state === "idle" && status.last_sync_at !== null) {
          void chats.reloadChats();
          void workspace?.refresh();
        }
      }),
    [activeProfileId, chats, workspace],
  );
  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      if (
        (view === "chats" || view === "settings") &&
        (event.metaKey || event.ctrlKey) &&
        event.key === "," &&
        !event.altKey &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        event.preventDefault();
        if (view === "settings") setView(settingsReturn);
        else {
          setSettingsReturn("chats");
          setSettingsEntry({ id: "shortcut", page: "general", email: "" });
          setView("settings");
        }
      }
    };
    document.addEventListener("keydown", openSettings);
    return () => document.removeEventListener("keydown", openSettings);
  }, [view, settingsReturn]);
  const [openChatRequest, setOpenChatRequest] = useState<{ id: string }>();
  useEffect(
    () =>
      subscribeNativeNavigation((id) => {
        setView("chats");
        setOpenChatRequest({ id });
      }),
    [],
  );
  const [stressConfig, setStressConfig] = useState<StressConfig>(DEFAULT_STRESS);
  const [stressAutoStart, setStressAutoStart] = useState(false);
  const [brandId, setBrandId] = useState<AgentBrandId>("claude-code");
  const snapshot = useStream(store);

  useEffect(() => {
    if (!inTauri()) {
      setBoot({ status: "outside" });
      return;
    }
    let live = true;
    installProfileEvents()
      .then(() => getAppInfo())
      .then(
        (info) => {
          if (!live) return;
          if (info.launch.type === "stress") {
            setStressConfig(info.launch.config);
            setStressAutoStart(true);
            setView("stress");
          }
          if (info.launch.type === "smoke") setView("chats");
          setBoot({ status: "ready", info });
        },
        (error: unknown) => {
          if (live) setBoot({ status: "failed", message: errorMessage(error) });
        },
      );
    const timers = LATE_NOTICE_CHECKS_MS.map((delay) =>
      setTimeout(() => {
        getAppInfo().then(
          (later) => {
            if (!live) return;
            setBoot((current) =>
              current.status === "ready"
                ? { status: "ready", info: withLateNotices(current.info, later) }
                : current,
            );
          },
          () => undefined,
        );
      }, delay),
    );
    return () => {
      live = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  // The material behind the window; with none, CSS paints the opaque base (see styles.css). Left
  // unset while loading, so the page never fades from one to the other.
  const glass =
    boot.status === "ready" ? boot.info.glass : boot.status === "loading" ? null : "none";
  useEffect(() => {
    if (glass !== null) document.documentElement.dataset.glass = glass;
  }, [glass]);

  // Once real content has painted, show the window; in smoke mode, then run the check. A ref, not
  // the effect's cleanup, guards this: StrictMode re-runs effects in development.
  const started = useRef(false);
  useEffect(() => {
    if (boot.status === "loading" || started.current || !inTauri()) return;
    started.current = true;
    void (async () => {
      try {
        await whenPainted(windowReady);
      } catch (error) {
        console.error("auracode: window_ready failed", error);
      }
      if (boot.status === "ready" && boot.info.launch.type === "smoke") {
        const { plan } = boot.info.launch;
        const hooks: SmokeHooks = {
          store,
          showHome: async () => {
            setView("diagnostics");
            await afterPaint(500);
          },
          showStress: async (config) => {
            setStressAutoStart(false);
            setStressConfig(config);
            setView("stress");
            await afterPaint(500);
          },
          renderedAnswer: () => {
            const answers = document.querySelectorAll("[data-answer]");
            return answers[answers.length - 1]?.textContent ?? "";
          },
          settle: () => afterPaint(500),
        };
        const report =
          plan.scenario === "stream"
            ? await runSmoke(boot.info, hooks)
            : await runChatSmoke(boot.info, plan, {
                showChats: async () => {
                  setView("chats");
                  await afterPaint(500);
                },
              });
        try {
          await sendSmokeReport(report);
        } catch (error) {
          console.error("auracode: smoke_report failed", error);
        }
      }
    })();
  }, [boot, store]);

  if (boot.status === "loading") return null;
  if (boot.status === "outside") {
    return (
      <ErrorScreen
        title="This is auracode's interface"
        message="It runs inside the desktop app, which provides its data and agents. Start it with `pnpm dev` from the repository root."
        dataDir={null}
        os=""
      />
    );
  }
  if (boot.status === "failed") {
    return (
      <ErrorScreen title="auracode could not start" message={boot.message} dataDir={null} os="" />
    );
  }

  const { info } = boot;
  if (info.config_profile_recovery) {
    const selectedProfile = info.profile?.id;
    const ownerProfile = info.config_profile_recovery.owner_profile;
    const access =
      ownerProfile && info.config_profile_recovery.phase !== "unavailable" ? (
        <AccountPanel
          recoveryOnly
          recoveryProfileId={ownerProfile}
          recoveryActionLabel={
            info.profile_locked ? "Unlock selected account" : "Recover configuration"
          }
          deviceName={info.device?.name ?? "My computer"}
          onActivate={async () => {
            if (info.profile_locked && selectedProfile) {
              await switchProfile(selectedProfile);
            } else {
              const recovered = await recoverProfileConfiguration();
              if (recovered.config_profile_recovery)
                throw new Error(recovered.config_profile_recovery.detail);
              window.location.reload();
            }
          }}
        />
      ) : null;
    return (
      <ConfigurationRecovery recovery={info.config_profile_recovery} locked={info.profile_locked}>
        {info.notices.map((notice) => (
          <p className="settings-footnote" key={notice}>
            {notice}
          </p>
        ))}
        {info.fatal ? (
          <p role="alert" className="settings-error">
            {info.fatal}
          </p>
        ) : null}
        {info.profile_locked ? (
          access
        ) : access ? (
          <details>
            <summary>Restore access to the account used by this switch</summary>
            {access}
          </details>
        ) : null}
      </ConfigurationRecovery>
    );
  }
  if (info.profile_locked) return <LockedProfile info={info} />;
  if (info.fatal !== null) {
    return (
      <ErrorScreen
        title="auracode couldn't open your data"
        message={info.fatal}
        dataDir={info.data_dir}
        os={info.os}
        notices={info.notices}
      />
    );
  }

  // The shell has acknowledged the repair, so `app_info` no longer reports it; mirror that here.
  // Not in the notice's own state: the home screen, notice included, unmounts while the stress
  // view is open and would come back showing the repair again.
  const onRecoveryDismissed = (): void => {
    setBoot((current) =>
      current.status === "ready"
        ? { status: "ready", info: { ...current.info, recovery_notice: null } }
        : current,
    );
  };

  const activity = snapshot.phase === "idle" ? "idle" : activityOf(snapshot.stream);
  const orbState: OrbState = activity;

  if (view === "setup")
    return (
      <Onboarding
        app={chats}
        transport={transport}
        workspace={workspace}
        restart={restartSetup}
        onDone={() => {
          setRestartSetup(false);
          setView("chats");
        }}
        onDemo={() => setView("diagnostics")}
        onAccount={() => {
          setRestartSetup(false);
          setSettingsReturn("setup");
          setSettingsEntry({ id: "setup", page: "account", email: "" });
          setView("settings");
        }}
      />
    );
  // Agents and the Plugin library stand alone in the inset pane (shell.css, .pane-shell).
  if (view === "agents")
    return (
      <div className="pane-shell g-root">
        <AgentsScreen
          app={chats}
          transport={transport}
          onBack={() => setView("chats")}
          onSetup={() => {
            setRestartSetup(true);
            setView("setup");
          }}
        />
      </div>
    );
  if (view === "chats" || view === "settings" || view === "library") {
    return (
      <>
        <div hidden={view !== "chats"} className="app-view">
          <ChatsScreen
            active={view === "chats"}
            workspace={workspace}
            openChatRequest={openChatRequest}
            app={chats}
            transport={transport}
            info={info}
            onRecoveryDismissed={onRecoveryDismissed}
            onDiagnostics={() => setView("diagnostics")}
            onAgents={() => setView("agents")}
            onCustomize={(projectId, activeChatId) => {
              setCustomizeEntry({ id: Date.now(), section: "plugins", projectId, activeChatId });
              setView("library");
            }}
            onSettings={() => {
              setSettingsReturn("chats");
              setSettingsEntry({ id: "chats", page: "general", email: "" });
              setView("settings");
            }}
            onInstructions={(target, chatLabel) => {
              const organization = workspace?.getSnapshot().data;
              const projectId =
                target.type === "chat"
                  ? organization?.chats.find((entry) => entry.chat.id === target.chat_id)
                      ?.project_id
                  : target.type === "folder"
                    ? organization?.projects.find((project) =>
                        project.folders.some((folder) => folder.id === target.folder_id),
                      )?.id
                    : null;
              setCustomizeEntry({
                id: Date.now(),
                section: "instructions",
                projectId: projectId ?? null,
                activeChatId: target.type === "chat" ? target.chat_id : undefined,
                target,
                chatLabel,
              });
              setView("library");
            }}
          />
        </div>
        {view === "settings" ? (
          <SettingsScreen
            navigationId={settingsEntry.id}
            initialPage={settingsEntry.page}
            initialEmail={settingsEntry.email}
            instructionsTarget={settingsEntry.target}
            chatLabel={settingsEntry.chatLabel}
            instructionFolders={workspace?.getSnapshot().data?.projects.flatMap((project) =>
              project.folders.map((folder) => ({
                id: folder.id,
                label:
                  project.folders.length > 1
                    ? `${project.name} / ${folder.display_name}`
                    : project.name,
              })),
            )}
            backLabel={settingsReturn === "setup" ? "Back to setup" : "Back to chats"}
            info={info}
            onImported={async () => {
              await Promise.all([chats.reloadChats(), workspace?.refresh()]);
            }}
            onBack={() => setView(settingsReturn)}
            onAgents={() => setView("agents")}
            onLibrary={() => {
              setCustomizeEntry({ id: Date.now(), section: "plugins", projectId: null });
              setView("library");
            }}
            onDiagnostics={() => setView("diagnostics")}
            onSetup={() => {
              setRestartSetup(true);
              setView("setup");
            }}
          />
        ) : null}
        {view === "library" ? (
          <CustomizeScreen
            key={customizeEntry.id}
            workspace={workspace}
            initialProjectId={customizeEntry.projectId}
            initialSection={customizeEntry.section}
            instructionsTarget={customizeEntry.target}
            chatLabel={customizeEntry.chatLabel}
            activeChatId={customizeEntry.activeChatId}
            onBack={() => setView("chats")}
            onAgents={() => setView("agents")}
          />
        ) : null}
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app diagnostics-shell">
        <Sidebar
          brandId={brandId}
          onBrandChange={setBrandId}
          orbState={orbState}
          onChats={() => {
            leaveStream(store);
            setStressAutoStart(false);
            setView("chats");
          }}
        />
        <main className="main">
          <div className="drag-strip" data-tauri-drag-region="" />
          <div className="main-scroll">
            {view === "diagnostics" ? (
              <Home
                info={info}
                store={store}
                onOpenStress={() => {
                  leaveStream(store);
                  setStressAutoStart(false);
                  setView("stress");
                }}
                onRecoveryDismissed={onRecoveryDismissed}
              />
            ) : (
              <StressView
                store={store}
                config={stressConfig}
                onConfigChange={setStressConfig}
                autoStart={stressAutoStart}
                onExit={() => {
                  leaveStream(store);
                  setStressAutoStart(false);
                  setView("diagnostics");
                }}
              />
            )}
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}

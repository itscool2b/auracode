import {
  AGENT_BRANDS,
  type AgentBrandId,
  AuraField,
  type AuraIntensity,
  brandCssVariables,
  type OrbState,
} from "@auracode/ui";
import { MotionConfig } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { AppInfo, StressConfig } from "./bindings";
import { ChatsScreen } from "./components/chat/ChatsScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { Home } from "./components/Home";
import { Sidebar } from "./components/Sidebar";
import { StressView } from "./components/StressView";
import { AgentsScreen } from "./components/setup/AgentsScreen";
import { Onboarding } from "./components/setup/Onboarding";
import type { AppStore } from "./lib/chat/appStore";
import type { Transport } from "./lib/chat/transport";
import { errorMessage } from "./lib/errors";
import { useStream } from "./lib/hooks";
import { getAppInfo, inTauri, sendSmokeReport, windowReady } from "./lib/ipc";
import { subscribeNativeNavigation } from "./lib/nativeNavigation";
import { LATE_NOTICE_CHECKS_MS, withLateNotices } from "./lib/notices";
import { afterPaint, whenPainted } from "./lib/ready";
import { isRunning, type StreamStore } from "./lib/session";
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
type View = "chats" | "diagnostics" | "stress" | "setup" | "agents";

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
  const [view, setView] = useState<View>("setup");
  const [restartSetup, setRestartSetup] = useState(false);
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
    getAppInfo().then(
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

  const brand = AGENT_BRANDS[brandId];
  const running = isRunning(snapshot);
  const activity = snapshot.phase === "idle" ? "idle" : activityOf(snapshot.stream);
  const orbState: OrbState = activity;
  const intensity: AuraIntensity = running && activity !== "idle" ? "active" : "calm";
  const showAura = view === "diagnostics" || stressConfig.aura;
  // The field drifts only while something streams; idle, it holds still and costs nothing.
  const auraPaused = !running && view === "diagnostics";

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
      />
    );
  if (view === "agents")
    return (
      <AgentsScreen
        app={chats}
        transport={transport}
        onBack={() => setView("chats")}
        onSetup={() => {
          setRestartSetup(true);
          setView("setup");
        }}
      />
    );
  if (view === "chats") {
    return (
      <ChatsScreen
        workspace={workspace}
        openChatRequest={openChatRequest}
        app={chats}
        transport={transport}
        info={info}
        onRecoveryDismissed={onRecoveryDismissed}
        onDiagnostics={() => setView("diagnostics")}
        onAgents={() => setView("agents")}
      />
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" style={brandCssVariables(brand) as CSSProperties}>
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
          {showAura ? <AuraField brand={brand} intensity={intensity} paused={auraPaused} /> : null}
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

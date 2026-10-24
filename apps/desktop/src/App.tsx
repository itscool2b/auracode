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
import { ErrorScreen } from "./components/ErrorScreen";
import { Home } from "./components/Home";
import { Sidebar } from "./components/Sidebar";
import { StressView } from "./components/StressView";
import { errorMessage } from "./lib/errors";
import { useStream } from "./lib/hooks";
import { getAppInfo, inTauri, sendSmokeReport, windowReady } from "./lib/ipc";
import { afterPaint, whenPainted } from "./lib/ready";
import { isRunning, type StreamStore } from "./lib/session";
import { runSmoke, type SmokeHooks } from "./lib/smoke";
import { activityOf } from "./lib/stream";
import { DEFAULT_STRESS } from "./lib/stress";

type Boot =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly info: AppInfo }
  | { readonly status: "outside" }
  | { readonly status: "failed"; readonly message: string };

type View = "home" | "stress";

/**
 * Switching views ends the current stream: the shell stops it (so it does not keep streaming into
 * a channel nobody reads) and the store forgets it (so the new view starts empty).
 */
function leaveStream(store: StreamStore): void {
  store
    .abandon()
    .catch((error: unknown) => console.error("auracode: could not stop the stream", error));
}

export function App({ store }: { readonly store: StreamStore }) {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [view, setView] = useState<View>("home");
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
        setBoot({ status: "ready", info });
      },
      (error: unknown) => {
        if (live) setBoot({ status: "failed", message: errorMessage(error) });
      },
    );
    return () => {
      live = false;
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
        const hooks: SmokeHooks = {
          store,
          showHome: async () => {
            setView("home");
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
        const report = await runSmoke(boot.info, hooks);
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

  const brand = AGENT_BRANDS[brandId];
  const running = isRunning(snapshot);
  const activity = snapshot.phase === "idle" ? "idle" : activityOf(snapshot.stream);
  const orbState: OrbState = activity;
  const intensity: AuraIntensity = running && activity !== "idle" ? "active" : "calm";
  const showAura = view === "home" || stressConfig.aura;
  // The field drifts only while something streams; idle, it holds still and costs nothing.
  const auraPaused = !running && view === "home";

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" style={brandCssVariables(brand) as CSSProperties}>
        <Sidebar brandId={brandId} onBrandChange={setBrandId} orbState={orbState} />
        <main className="main">
          {showAura ? <AuraField brand={brand} intensity={intensity} paused={auraPaused} /> : null}
          <div className="drag-strip" data-tauri-drag-region="" />
          <div className="main-scroll">
            {view === "home" ? (
              <Home
                info={info}
                store={store}
                onOpenStress={() => {
                  leaveStream(store);
                  setStressAutoStart(false);
                  setView("stress");
                }}
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
                  setView("home");
                }}
              />
            )}
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}

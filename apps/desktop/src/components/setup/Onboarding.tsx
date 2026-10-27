import { usePrefersReducedMotion } from "@auracode/ui";
import { gridPath, Keycap, Wordmark } from "@auracode/ui/graphite";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, Check, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type {
  MotionPreference,
  ProjectSummary,
  SetupAction,
  SetupSnapshot,
  SetupStep,
} from "../../bindings";
import type { AppStore } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { inTauri } from "../../lib/ipc";
import { type SetupApi, setMotionPreference, setupApi } from "../../lib/setup";
import type { WorkspaceStore } from "../../lib/workspace";
import { projectName } from "../chat/ChatList";
import { AgentRoster } from "./AgentsScreen";
import { CloneProject } from "./CloneProject";
import { type IntroMode, SetupIntro } from "./SetupIntro";
import { primaryAgents, SetupPanel } from "./SetupPanel";
import "./setup.css";

const STEPS: readonly { id: SetupStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "agents", label: "Your agents" },
  { id: "account", label: "Account" },
  { id: "motion", label: "Motion" },
  { id: "project", label: "First project" },
];

const MOTION: Record<MotionPreference, string> = { full: "Full", reduced: "Reduced", off: "Off" };

/** The done check as pixels (5 by 4), at 2px cells inside the 20px step square. */
const CHECK = ["....#", "...#.", "#.#..", ".#..."];
const CHECK_PATH = gridPath(CHECK, 2, 5, 6);

/** How long the intro holds before setup shows: the dissolve on a first launch, a beat later. */
const INTRO_MS = { live: 1800, still: 240, reducedFirst: 300 } as const;
/** The intro fades out over the dither reveal (800ms), or quickly once someone skips it. */
const FADE_MS = { slow: 800, fast: 240 } as const;

function StepMark({
  state,
  number,
}: {
  readonly state: "done" | "active" | "pending";
  number: number;
}) {
  return (
    <span className="setup-step-mark" data-state={state} aria-hidden="true">
      {state === "done" ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <path d={CHECK_PATH} fill="currentColor" />
        </svg>
      ) : (
        number
      )}
    </span>
  );
}

export function Onboarding({
  app,
  transport,
  workspace,
  restart = false,
  onDone,
  onDemo,
  onAccount,
  api = setupApi,
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly workspace?: WorkspaceStore;
  readonly restart?: boolean;
  readonly onDone: () => void;
  readonly onDemo: () => void;
  readonly onAccount: () => void;
  readonly api?: SetupApi;
}) {
  const reduced = usePrefersReducedMotion();
  const agentsState = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const [saved, setSaved] = useState<SetupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cinematic, setCinematic] = useState(!restart);
  const [skipped, setSkipped] = useState(false);
  const [introGone, setIntroGone] = useState(restart);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState<readonly ProjectSummary[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const started = useRef<Promise<SetupSnapshot> | null>(null);
  const lock = useRef(false);
  const motionHint = useId();
  const agents = agentsState.agents ?? [];
  const step = saved?.preferences.step ?? "welcome";
  const index = STEPS.findIndex((item) => item.id === step);
  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);
  useEffect(() => {
    let live = true;
    // A StrictMode remount joins the first request, including an explicit Restart mutation.
    started.current ??= api
      .snapshot()
      .then((value) =>
        restart ? api.apply(value.preferences.revision, { type: "restart" }) : value,
      );
    void started.current.then(
      (value) => {
        if (!live) return;
        setMotionPreference(value.preferences.motion);
        setSaved(value);
      },
      (reason) => {
        if (live) {
          setError(errorMessage(reason));
          setCinematic(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, restart]);
  useEffect(() => {
    if (!saved || !cinematic) return;
    // A first launch plays the dissolve; later launches and reduced motion hold the formed mark.
    const hold = saved.cold_start
      ? reduced
        ? INTRO_MS.reducedFirst
        : INTRO_MS.live
      : reduced
        ? 0
        : INTRO_MS.still;
    if (hold === 0) {
      setCinematic(false);
      return;
    }
    const timer = setTimeout(() => setCinematic(false), hold);
    return () => clearTimeout(timer);
  }, [saved, cinematic, reduced]);
  useEffect(() => {
    if (cinematic || introGone) return;
    if (reduced) {
      setIntroGone(true);
      return;
    }
    const timer = setTimeout(() => setIntroGone(true), skipped ? FADE_MS.fast : FADE_MS.slow);
    return () => clearTimeout(timer);
  }, [cinematic, introGone, reduced, skipped]);
  useEffect(() => {
    if (saved?.preferences.completed && !cinematic) onDone();
  }, [saved, cinematic, onDone]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Moving to a different step must announce its heading.
  useEffect(() => {
    if (!cinematic) heading.current?.focus();
  }, [step, cinematic]);
  useEffect(() => {
    if (!cinematic) return;
    const skip = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        setSkipped(true);
        setCinematic(false);
      }
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [cinematic]);
  useEffect(() => {
    if (step !== "project" || !workspace) return;
    let live = true;
    void workspace.api.snapshot().then(
      (value) => {
        if (!live) return;
        setExisting(value.projects);
        setProject(
          value.projects.find((item) => item.id === saved?.preferences.first_project_id) ?? null,
        );
      },
      (reason) => {
        if (live) setError(errorMessage(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [step, workspace, saved?.preferences.first_project_id]);
  useEffect(() => {
    if (step !== "project" || !inTauri()) return;
    let live = true;
    let unlisten: (() => void) | undefined;
    void listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      if (!live || lock.current) return;
      if (event.payload.paths.length !== 1) {
        setError("Drop one project folder at a time.");
        return;
      }
      const path = event.payload.paths[0];
      if (path) {
        setFolder(path);
        setName(projectName(path));
        setProject(null);
      }
    }).then(
      (stop) => {
        if (live) unlisten = stop;
        else stop();
      },
      (reason) => {
        if (live) setError(errorMessage(reason));
      },
    );
    return () => {
      live = false;
      unlisten?.();
    };
  }, [step]);

  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const apply = async (action: SetupAction) => {
    if (!saved) return;
    const value = await api.apply(saved.preferences.revision, action);
    setSaved(value);
    setMotionPreference(value.preferences.motion);
  };
  const advance = () =>
    void run(() =>
      apply(
        index === STEPS.length - 1
          ? { type: "finish" }
          : { type: "visit", step: STEPS[index + 1]?.id ?? "project" },
      ),
    );
  const pick = () =>
    void run(async () => {
      const path = await transport.pickFolder();
      if (path) {
        setFolder(path);
        setName(projectName(path));
        setProject(null);
      }
    });
  const saveProject = () =>
    void run(async () => {
      if (!workspace || !saved) return;
      // Keep the created project in memory if saving setup subsequently fails. Retrying cannot
      // create a second project, and the existing-project list makes it recoverable after restart.
      const selected =
        project ??
        (await workspace.api.createProject({
          folder,
          project: { name, color: null, default_agent: null, default_model: null },
        }));
      setProject(selected);
      await apply({ type: "project", project_id: selected.id });
      await workspace.refresh();
    });
  const roster = primaryAgents(agents);
  const installed = roster.filter((agent) => agent.availability.state === "ready").length;
  const looking = roster.filter((agent) => agent.availability.state === "checking").length;
  const absent = roster.length - installed - looking;
  useEffect(() => {
    if (cinematic || busy || !saved) return;
    const next = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, input, select, textarea, a, dialog, [contenteditable=true]")
      )
        return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", next);
    return () => window.removeEventListener("keydown", next);
  });
  // Agents follows the scan, so the heading always says what this computer actually has.
  const agentsHeading: [string, string] =
    agentsState.agents === null
      ? ["Looking for agents.", "Checking this computer."]
      : looking > 0
        ? ["Looking for agents.", `Still looking for ${looking}.`]
        : installed === 0
          ? ["No agents found.", "Install one, or try the demo."]
          : [
              `Found ${installed} ${installed === 1 ? "agent" : "agents"}.`,
              absent > 0 ? `${absent} more can be installed.` : "Nothing left to install.",
            ];
  const headings: Record<SetupStep, [string, string]> = {
    welcome: ["Welcome to auracode.", "Your agents, one window."],
    agents: agentsHeading,
    account: ["Sync across machines.", "Or keep auracode local."],
    motion: ["Choose how much moves.", "Change it in Settings."],
    project: ["Add a first project.", "Any folder works."],
  };
  const summaries: Partial<Record<SetupStep, string>> = {
    agents: agentsState.agents === null ? undefined : `${installed} installed`,
    motion: saved ? MOTION[saved.preferences.motion] : undefined,
  };
  const introMode: IntroMode =
    saved === null ? "pending" : saved.cold_start && !reduced ? "live" : "still";
  const motion = saved?.preferences.motion;
  return (
    <main className="setup-shell g-root" data-cinematic={cinematic || undefined}>
      <div className="setup-drag" data-tauri-drag-region="" />
      <section className="setup-column">
        <header className="setup-top">
          <Wordmark size={16} />
          <button
            type="button"
            className="g-button g-button-ghost g-button-28 setup-skip"
            disabled={busy}
            onClick={() => (saved ? void run(() => apply({ type: "finish" })) : onDone())}
          >
            Skip setup
          </button>
        </header>
        <div className="setup-body">
          <div className="setup-checklist">
            <nav aria-label="Setup steps" className="setup-steps">
              {STEPS.slice(0, index + 1).map((item, at) => (
                <button
                  key={item.id}
                  type="button"
                  className="setup-step"
                  aria-current={step === item.id ? "step" : undefined}
                  disabled={busy || !saved}
                  onClick={() => void run(() => apply({ type: "visit", step: item.id }))}
                >
                  <StepMark state={at < index ? "done" : "active"} number={at + 1} />
                  <span className="setup-step-title">{item.label}</span>
                  {at < index && summaries[item.id] ? (
                    <span className="setup-step-summary">{summaries[item.id]}</span>
                  ) : null}
                  {at < index ? <span className="sr-only">, done</span> : null}
                </button>
              ))}
            </nav>
            <div className="setup-content" key={step}>
              <h1 ref={heading} tabIndex={-1} className="setup-heading">
                {headings[step][0]}
                <span>{headings[step][1]}</span>
              </h1>
              {step === "welcome" ? (
                <>
                  <p className="setup-lead">
                    Run the coding agents already on this computer in one chat window. Each keeps
                    its own sign-in.
                  </p>
                  <p className="setup-footnote">Local first. No account needed.</p>
                </>
              ) : null}
              {step === "agents" ? (
                <>
                  <AgentRoster
                    compact
                    agents={roster}
                    transport={transport}
                    onRefresh={() => void app.refreshAgents()}
                  />
                  <div className="setup-inline">
                    <span className="setup-footnote">
                      {agents.length
                        ? `${installed} installed. Sign-in is checked only when you ask.`
                        : "Looking for installed agents…"}
                    </span>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      disabled={agentsState.agentsRefreshing}
                      onClick={() => void app.refreshAgents()}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      Refresh
                    </button>
                  </div>
                  {installed === 0 ? (
                    <button
                      type="button"
                      className="g-button g-button-outline setup-demo"
                      onClick={onDemo}
                    >
                      Explore the local demo <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </>
              ) : null}
              {step === "account" ? (
                <>
                  <p className="setup-lead">
                    Local is free and works offline without an account. Cloud accounts, encrypted
                    sync and transfers are invite-only during private preview.
                  </p>
                  <button type="button" className="g-button g-button-outline" onClick={onAccount}>
                    Open Account
                  </button>
                  <p className="setup-footnote">
                    Have an invitation? Sign in with your invited email. You can also continue with
                    Local.
                  </p>
                </>
              ) : null}
              {step === "motion" ? (
                <>
                  <p className="setup-lead">
                    Full keeps transitions and the live field. Reduced and Off hold them still.
                  </p>
                  <fieldset className="setup-motion" aria-describedby={motionHint}>
                    <legend className="sr-only">Interface motion</legend>
                    <div className="setup-segmented">
                      {(["full", "reduced", "off"] as const).map((value) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="motion"
                            value={value}
                            disabled={busy || !saved}
                            checked={motion === value}
                            onChange={() => void run(() => apply({ type: "motion", value }))}
                          />
                          <span>{MOTION[value]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="setup-footnote" id={motionHint}>
                    Full still follows your system's reduced motion setting.
                  </p>
                </>
              ) : null}
              {step === "project" ? (
                <>
                  <p className="setup-lead">
                    Choose an existing folder or drop one into this window. Its files stay where
                    they are.
                  </p>
                  <button
                    type="button"
                    className="setup-folder"
                    disabled={busy || !workspace}
                    onClick={pick}
                  >
                    <FolderOpen size={20} aria-hidden="true" />
                    <span>
                      <strong>{folder ? projectName(folder) : "Choose a folder"}</strong>
                      <small className={folder ? "setup-path" : undefined}>
                        {folder || "Or drop a folder here"}
                      </small>
                    </span>
                  </button>
                  {folder ? (
                    <form
                      className="setup-project-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveProject();
                      }}
                    >
                      <label className="setup-field">
                        Project name
                        <input
                          className="g-input"
                          required
                          maxLength={128}
                          value={name}
                          disabled={busy}
                          onChange={(event) => setName(event.currentTarget.value)}
                        />
                      </label>
                      <button
                        type="submit"
                        className="g-button g-button-outline g-button-36"
                        disabled={busy || !name.trim()}
                      >
                        {project ? "Save selection" : "Add project"}
                      </button>
                    </form>
                  ) : null}
                  {existing.length > 0 ? (
                    <label className="setup-field">
                      Or choose a project
                      <select
                        className="g-input"
                        disabled={busy}
                        value={project?.id ?? ""}
                        onChange={(event) => {
                          const selected = existing.find(
                            (item) => item.id === event.currentTarget.value,
                          );
                          if (selected) {
                            setProject(selected);
                            setFolder("");
                            void run(() => apply({ type: "project", project_id: selected.id }));
                          }
                        }}
                      >
                        <option value="">Select a project</option>
                        {existing.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {saved?.preferences.first_project_id && project ? (
                    <p role="status" className="setup-project-saved">
                      <Check size={14} aria-hidden="true" /> {project.name} is ready.
                    </p>
                  ) : null}
                  <CloneProject
                    disabled={busy || !workspace}
                    pickParent={() => transport.pickFolder()}
                    onFolder={(path) => {
                      setFolder(path);
                      setName(projectName(path));
                      setProject(null);
                    }}
                  />
                </>
              ) : null}
              {saved?.notice ? (
                <p className="setup-footnote" role="status">
                  {saved.notice}
                </p>
              ) : null}
              {error ? (
                <div className="setup-error" role="alert">
                  <p>{error}</p>
                  <div>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      onClick={() =>
                        void run(async () => {
                          const value = await api.snapshot();
                          setSaved(value);
                          setMotionPreference(value.preferences.motion);
                        })
                      }
                    >
                      Reload saved setup
                    </button>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      onClick={onDone}
                    >
                      Continue without saving setup
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="setup-actions">
                <button
                  type="button"
                  className="g-button g-button-primary g-button-36"
                  disabled={busy || !saved}
                  onClick={advance}
                >
                  {busy
                    ? "Saving…"
                    : step === "welcome"
                      ? "Get started"
                      : step === "project"
                        ? "Open auracode"
                        : "Continue"}
                  <span className="setup-enter" aria-hidden="true">
                    <Keycap>↵</Keycap>
                  </span>
                </button>
                {index > 0 ? (
                  <button
                    type="button"
                    className="g-button g-button-ghost g-button-36"
                    disabled={busy}
                    onClick={advance}
                  >
                    Skip this step
                  </button>
                ) : null}
              </div>
            </div>
            {index < STEPS.length - 1 ? (
              <nav aria-label="Remaining setup steps" className="setup-steps setup-upcoming">
                {STEPS.slice(index + 1).map((item, at) => (
                  <button
                    key={item.id}
                    type="button"
                    className="setup-step"
                    disabled={busy || !saved}
                    onClick={() => void run(() => apply({ type: "visit", step: item.id }))}
                  >
                    <StepMark state="pending" number={at + index + 2} />
                    <span className="setup-step-title">{item.label}</span>
                  </button>
                ))}
              </nav>
            ) : null}
          </div>
        </div>
        <footer className="setup-bottom">Everything here can be changed later.</footer>
      </section>
      <SetupPanel agents={agents} />
      {introGone ? null : (
        <SetupIntro mode={introMode} leaving={cinematic ? false : skipped ? "fast" : "slow"} />
      )}
      {cinematic ? (
        <button
          type="button"
          className="g-button g-button-ghost g-button-28 setup-skip-intro"
          onClick={() => {
            setSkipped(true);
            setCinematic(false);
          }}
        >
          Skip intro <Keycap>Esc</Keycap>
        </button>
      ) : null}
    </main>
  );
}

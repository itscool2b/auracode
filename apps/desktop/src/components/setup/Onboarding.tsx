import { usePrefersReducedMotion } from "@auracode/ui";
import { DitherField, Keycap, Wordmark } from "@auracode/ui/graphite";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, Check, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  AgentEntry,
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
import "./setup.css";

/**
 * Four steps, each skippable: Continue never requires anything. Motion is not one of them: Full
 * already follows the system's reduced motion, and Settings changes it.
 */
const STEPS: readonly { id: SetupStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "agents", label: "Your agents" },
  { id: "account", label: "Account" },
  { id: "project", label: "First project" },
];

/** How long the intro holds before setup shows: the dissolve on a first launch, a beat later. */
const INTRO_MS = { live: 1800, still: 240, reducedFirst: 300 } as const;
/** The intro fades out over the dither reveal (800ms), or quickly once someone skips it. */
const FADE_MS = { slow: 800, fast: 240 } as const;
/**
 * The field gathers at the window's sides and thins to black behind the column and along the top
 * edge, where the wordmark and Skip setup sit (the site hero's clearings).
 */
const TOP_CLEARING = { x: 0.5, y: 0, rx: 1, ry: 0.22 } as const;
/** The column's clearing reaches at least 400px from the centre, so narrow windows stay calm. */
function clearing(width: number) {
  return [
    { x: 0.5, y: 0.46, rx: Math.min(0.5, Math.max(0.34, 400 / width)), ry: 0.8 },
    TOP_CLEARING,
  ];
}

/** Setups saved before motion left the steps resume at the step that followed it. */
function current(step: SetupStep | undefined): SetupStep {
  if (step === undefined) return "welcome";
  return step === "motion" ? "project" : step;
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
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  // Rounded so a window drag rebuilds the field's clearing only every 40px.
  const field = useMemo(() => clearing(Math.round(width / 40) * 40), [width]);
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
  const agents = agentsState.agents ?? [];
  const step = current(saved?.preferences.step);
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
        event.target.closest(
          "button, input, select, textarea, a, dialog, [role=menu], [contenteditable=true]",
        )
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
    account: ["Accounts are optional.", "auracode works without one."],
    motion: ["Add a first project.", "Any folder works."],
    project: ["Add a first project.", "Any folder works."],
  };
  const introMode: IntroMode =
    saved === null ? "pending" : saved.cold_start && !reduced ? "live" : "still";
  return (
    <main className="setup-shell g-root" data-cinematic={cinematic || undefined}>
      <DitherField
        className="setup-backdrop"
        palette="quiet"
        density={0.36}
        edges={0.85}
        ceiling={0.6}
        accent={0.002}
        clearing={field}
        interactive
        still={reduced}
      />
      <div className="setup-drag" data-tauri-drag-region="" />
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
      <section className="setup-column">
        <nav aria-label="Setup steps" className="setup-progress">
          <ol>
            {STEPS.map((item, at) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="setup-progress-step"
                  data-state={at < index ? "done" : at === index ? "current" : "next"}
                  aria-current={at === index ? "step" : undefined}
                  aria-label={`${item.label}${at < index ? ", done" : ""}`}
                  title={item.label}
                  disabled={busy || !saved || at === index}
                  onClick={() => void run(() => apply({ type: "visit", step: item.id }))}
                >
                  <span aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="setup-content" key={step}>
          <h1 ref={heading} tabIndex={-1} className="setup-heading">
            {headings[step][0]}
            <span>{headings[step][1]}</span>
          </h1>
          {step === "welcome" ? (
            <p className="setup-lead">
              Run the coding agents already on this computer in one chat window. Each keeps its own
              sign-in, and nothing leaves this machine.
            </p>
          ) : null}
          {step === "agents" ? (
            <>
              <AgentRoster
                agents={roster}
                transport={transport}
                onRefresh={() => void app.refreshAgents()}
              />
              <div className="setup-inline">
                {installed === 0 && agentsState.agents !== null && looking === 0 ? (
                  <button type="button" className="g-button g-button-outline" onClick={onDemo}>
                    Explore the local demo <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28 setup-refresh"
                  disabled={agentsState.agentsRefreshing}
                  onClick={() => void app.refreshAgents()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {agentsState.agentsRefreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </>
          ) : null}
          {step === "account" ? (
            <>
              <p className="setup-lead">
                auracode runs on this computer, offline, with no account. Sync between your devices
                is invite-only for now: if you have an invitation, sign in with that email.
              </p>
              <button type="button" className="g-button g-button-outline" onClick={onAccount}>
                Open Account
              </button>
            </>
          ) : null}
          {step === "project" ? (
            <>
              <p className="setup-lead">
                Choose a folder, drop one into this window or clone one from GitHub. Its files stay
                where they are.
              </p>
              <button
                type="button"
                className="setup-folder"
                data-chosen={folder ? true : undefined}
                disabled={busy || !workspace}
                onClick={pick}
              >
                <FolderOpen size={20} aria-hidden="true" />
                <span>
                  <strong>{folder ? projectName(folder) : "Choose a folder"}</strong>
                  <small className={folder ? "setup-path" : undefined}>
                    {folder || "or drop it here"}
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
              {saved?.preferences.first_project_id && project ? (
                <p role="status" className="setup-project-saved">
                  <Check size={14} aria-hidden="true" /> {project.name} is ready.
                </p>
              ) : null}
              <div className="setup-project-more">
                <CloneProject
                  disabled={busy || !workspace}
                  pickParent={() => transport.pickFolder()}
                  onFolder={(path) => {
                    setFolder(path);
                    setName(projectName(path));
                    setProject(null);
                  }}
                />
                {existing.length > 0 ? (
                  <select
                    className="g-select setup-existing"
                    aria-label="Or choose a project"
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
                    <option value="">Or choose a project</option>
                    {existing.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
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
          </div>
        </div>
      </section>
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

/** Transport aliases stay visible on Agents; setup shows one row per harness. */
export function primaryAgents(agents: readonly AgentEntry[]): readonly AgentEntry[] {
  return agents.filter(
    (agent) =>
      !agent.id.endsWith("-acp") &&
      !agent.id.endsWith("-stream") &&
      agent.id !== "mock" &&
      agent.id !== "opencode-v2",
  );
}

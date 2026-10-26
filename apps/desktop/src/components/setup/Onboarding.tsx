import { usePrefersReducedMotion } from "@auracode/ui";
import { OrbitMark, useOrbitTheme } from "@auracode/ui/orbit";
import { listen } from "@tauri-apps/api/event";
import { ArrowRight, Check, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ProjectSummary, SetupAction, SetupSnapshot, SetupStep } from "../../bindings";
import type { AppStore } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { inTauri } from "../../lib/ipc";
import { type SetupApi, setMotionPreference, setupApi } from "../../lib/setup";
import type { WorkspaceStore } from "../../lib/workspace";
import { projectName } from "../chat/ChatList";
import { AgentRoster } from "./AgentsScreen";
import { CloneProject } from "./CloneProject";
import { NightPanel, primaryAgents } from "./NightPanel";
import "./setup.css";

const STEPS: readonly { id: SetupStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "agents", label: "Your agents" },
  { id: "account", label: "Account" },
  { id: "motion", label: "Motion" },
  { id: "project", label: "First project" },
];

export function Onboarding({
  app,
  transport,
  workspace,
  restart = false,
  onDone,
  onDemo,
  api = setupApi,
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly workspace?: WorkspaceStore;
  readonly restart?: boolean;
  readonly onDone: () => void;
  readonly onDemo: () => void;
  readonly api?: SetupApi;
}) {
  const theme = useOrbitTheme();
  const reduced = usePrefersReducedMotion();
  const agentsState = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const [saved, setSaved] = useState<SetupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cinematic, setCinematic] = useState(!restart);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState<readonly ProjectSummary[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const started = useRef<Promise<SetupSnapshot> | null>(null);
  const lock = useRef(false);
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
    if (reduced) {
      setCinematic(false);
      return;
    }
    const timer = setTimeout(() => setCinematic(false), saved.cold_start ? 1800 : 240);
    return () => clearTimeout(timer);
  }, [saved, cinematic, reduced]);
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
      if (event.key === "Escape" || event.key === "Enter") setCinematic(false);
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
  const installed = primaryAgents(agents).filter(
    (agent) => agent.availability.state === "ready",
  ).length;
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
  const headings: Record<SetupStep, [string, string]> = {
    welcome: ["A little space.", "For your next big thing."],
    agents: ["Your agents, together.", "Already on your machine."],
    account: ["Start where you are.", "An account is optional."],
    motion: ["Set your pace.", "Keep what feels right."],
    project: ["Make room for the work.", "Start with a folder."],
  };
  return (
    <main
      className="setup-shell orbit-theme"
      data-theme={theme}
      data-cinematic={cinematic || undefined}
    >
      <section className="setup-column">
        <header className="setup-top">
          <span className="setup-wordmark">
            <OrbitMark agent="auracode" size={24} />
            auracode
          </span>
          <button
            type="button"
            className="setup-text-button"
            disabled={busy}
            onClick={() => (saved ? void run(() => apply({ type: "finish" })) : onDone())}
          >
            Skip setup
          </button>
        </header>
        <div className="setup-body">
          <nav aria-label="Setup steps" className="setup-steps">
            {STEPS.slice(0, index + 1).map((item, at) => (
              <button
                key={item.id}
                type="button"
                aria-current={step === item.id ? "step" : undefined}
                disabled={busy || !saved}
                onClick={() => void run(() => apply({ type: "visit", step: item.id }))}
              >
                <span>{at < index ? <Check size={11} /> : at + 1}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="setup-content">
            <h1 ref={heading} tabIndex={-1}>
              {headings[step][0]}
              <span>{headings[step][1]}</span>
            </h1>
            {step === "welcome" ? (
              <>
                <p className="setup-intro">
                  Bring your own coding agents. Give every project a place to think, build and come
                  back to.
                </p>
                <p className="setup-footnote">
                  Local first. No account required. Your agents keep their own sign-ins.
                </p>
              </>
            ) : null}
            {step === "agents" ? (
              <>
                <AgentRoster
                  compact
                  agents={primaryAgents(agents)}
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
                    className="setup-text-button"
                    disabled={agentsState.agentsRefreshing}
                    onClick={() => void app.refreshAgents()}
                  >
                    Refresh
                  </button>
                </div>
                {installed === 0 ? (
                  <button type="button" className="setup-text-button" onClick={onDemo}>
                    Explore the local demo <ArrowRight size={14} />
                  </button>
                ) : null}
              </>
            ) : null}
            {step === "account" ? (
              <>
                <p className="setup-intro">
                  Your projects and chats work offline. Cloud sign-in and encrypted sync will be
                  available when account services are enabled for this build.
                </p>
                <button type="button" className="setup-button" disabled>
                  Account sign-in unavailable
                </button>
                <p className="setup-footnote">
                  Continue locally. Setup never signs in to an agent or sends a prompt.
                </p>
              </>
            ) : null}
            {step === "motion" ? (
              <>
                <p className="setup-intro">A quiet workspace, with as much movement as you want.</p>
                <fieldset className="setup-motion">
                  <legend>Interface motion</legend>
                  {(["full", "reduced", "off"] as const).map((value) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="motion"
                        value={value}
                        disabled={busy || !saved}
                        checked={saved?.preferences.motion === value}
                        onChange={() => void run(() => apply({ type: "motion", value }))}
                      />
                      <strong>
                        {value === "full" ? "Full" : value === "reduced" ? "Reduced" : "Off"}
                      </strong>
                      <small>
                        {value === "full"
                          ? "Subtle transitions"
                          : value === "reduced"
                            ? "Less movement"
                            : "Still by default"}
                      </small>
                    </label>
                  ))}
                </fieldset>
                <p className="setup-footnote">
                  Full also respects your system's reduced-motion setting. Auracode always uses its
                  dark appearance.
                </p>
              </>
            ) : null}
            {step === "project" ? (
              <>
                <p className="setup-intro">
                  Choose an existing folder or drop one into this window. Its files stay where they
                  are.
                </p>
                <button
                  type="button"
                  className="setup-folder"
                  disabled={busy || !workspace}
                  onClick={pick}
                >
                  <FolderOpen size={23} />
                  <span>
                    <strong>{folder ? projectName(folder) : "Choose a folder"}</strong>
                    <small>{folder || "Or drop a folder here"}</small>
                  </span>
                </button>
                {folder ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveProject();
                    }}
                  >
                    <label className="setup-field">
                      Project name
                      <input
                        required
                        maxLength={128}
                        value={name}
                        disabled={busy}
                        onChange={(event) => setName(event.currentTarget.value)}
                      />
                    </label>
                    <button type="submit" className="setup-button" disabled={busy || !name.trim()}>
                      {project ? "Save selection" : "Add project"}
                    </button>
                  </form>
                ) : null}
                {existing.length > 0 ? (
                  <label className="setup-field">
                    Or choose a project
                    <select
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
                    <Check size={14} /> {project.name} is ready.
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
                <button
                  type="button"
                  className="setup-text-button"
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
                <button type="button" className="setup-text-button" onClick={onDone}>
                  Continue without saving setup
                </button>
              </div>
            ) : null}
            <div className="setup-actions">
              <button
                type="button"
                className="setup-button setup-primary"
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
                <ArrowRight size={15} />
              </button>
              {index > 0 ? (
                <button
                  type="button"
                  className="setup-text-button"
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
                  disabled={busy || !saved}
                  onClick={() => void run(() => apply({ type: "visit", step: item.id }))}
                >
                  <span>{at + index + 2}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          ) : null}
        </div>
        <footer className="setup-bottom">Everything here can be changed later.</footer>
      </section>
      <NightPanel
        agents={agents}
        project={project ? { name: project.name, path: project.folders[0]?.path ?? "" } : null}
        cinematic={cinematic}
      />
      {cinematic ? (
        <button type="button" className="setup-skip-intro" onClick={() => setCinematic(false)}>
          Skip intro <kbd>Esc</kbd>
        </button>
      ) : null}
    </main>
  );
}

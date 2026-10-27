import { AgentMark, Logo, PixelLoader } from "@auracode/ui/graphite";
import { Folder, RefreshCw } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AgentAuthStatus,
  AgentEntry,
  AgentInstallation,
  ChatCreatePreview,
  ChatSummary,
  WorktreeChatPlan,
  WorktreeChatResult,
} from "../../bindings";
import { agentChoice, type NewChatDraft } from "../../lib/chat/appStore";
import { WorktreeChoice } from "../../lib/chat/worktreeChoice";
import { errorMessage } from "../../lib/errors";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { type WorktreeChatApi, worktreeChatApi } from "../../lib/worktreeChat";
import { TerminalSheet } from "../TerminalSheet";
import { projectName } from "./ChatList";
import { WorktreeChip } from "./WorktreeChip";
import "./new-chat.css";

const noSubscribe = () => () => {};
const emptyWorkspace = () => EMPTY_WORKSPACE;

/** The download consent sentence of an agent whose first start downloads its adapter. */
export function downloadNote(agent: AgentEntry): string | null {
  if (!agent.needs_download) return null;
  // `launch` reads "<package> <version> with your <binary>" for npm adapters.
  const what = agent.launch.split(" with your ")[0] || agent.launch;
  return `Creating this chat downloads ${what} from npm (one time).`;
}

/** Installation evidence is separate from whether the version command succeeds. */
export function InstallationStatus({ installation }: { readonly installation: AgentInstallation }) {
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
            : "Install channel unknown";
  const evidence = installation.verification;
  return (
    <span className="ui-muted" data-testid="agent-installation">
      {label}
      {installation.host.type === "wsl" ? ` · WSL ${installation.host.distro}` : null}
      {evidence.state === "untested" ? (
        <small
          title={
            evidence.last_verified === null
              ? "No verified baseline"
              : `Last verified: ${evidence.last_verified}`
          }
        >
          {" "}
          · Untested version
        </small>
      ) : null}
      {evidence.state === "verified" ? (
        <small title={evidence.scope}> · {evidence.scope}</small>
      ) : null}
      {evidence.state === "unknown" ? <small> · Compatibility unverified</small> : null}
    </span>
  );
}

export function authStatusText(status: AgentAuthStatus): string {
  switch (status.state) {
    case "credentials_present":
      return "The agent reports local sign-in credentials. Access is confirmed by the agent when it runs.";
    case "sign_in_required":
      return "Sign in using the agent's own terminal login command.";
    case "unknown":
      return status.reason;
    case "unsupported":
      return "This agent has no supported sign-in status command.";
  }
}

/** What the selected agent will run, once detection found it. */
function readyLine(agent: AgentEntry): string | null {
  switch (agent.availability.state) {
    case "ready":
      return agent.availability.version === null
        ? agent.availability.path
        : `${agent.availability.version} (${agent.availability.path})`;
    case "checking":
      return "Still checking this agent; the chat starts once it is found.";
    case "missing":
    case "broken":
      return null;
  }
}

/** An agent choice's state: still detected, found, or waiting on the person to sign in. */
type ChoiceState = "detecting" | "ready" | "sign-in";

const STATE_LABEL: Record<ChoiceState, string> = {
  detecting: "looking for it",
  ready: "ready",
  "sign-in": "needs sign-in",
};

/**
 * After Create made a worktree chat: its saved setup command waits in the owned terminal before
 * the agent starts, or the chat is ready with notes worth reading before it opens.
 */
type Created =
  | { readonly type: "idle" }
  | {
      readonly type: "setup";
      readonly result: WorktreeChatResult;
      readonly plan: WorktreeChatPlan;
      readonly token: string;
    }
  | { readonly type: "starting"; readonly result: WorktreeChatResult }
  | { readonly type: "done"; readonly result: WorktreeChatResult; readonly notes: string[] };

/** One sentence for a setup command that did not finish cleanly. */
export function setupNote(exit: number | null | "closed"): string | null {
  if (exit === 0) return null;
  if (exit === "closed")
    return "The setup command did not run to the end. Run it again from the chat's Git panel.";
  if (exit === null)
    return "The setup terminal closed without an exit status. Review setup from the chat's Git panel.";
  return `The setup command exited with code ${exit}. Review setup from the chat's Git panel.`;
}

/**
 * New chat, after Grok's start screen: the logo, one sentence, and one composer card holding the
 * agents that can run here (each showing whether it is still being looked for, ready, or waiting
 * on a sign-in), the folder, and Create. Agents that cannot run here wait under "Other agents"
 * with their reason. Creating the chat starts its agent; errors show under the card.
 *
 * In a Git project folder the chat gets its own worktree by default (the Codex app's per-thread
 * Worktree mode): one chip row under the card says where it will work, and its popover changes
 * that. A plain folder shows nothing extra and the chat works in it directly.
 */
export function NewChat({
  agents,
  refreshing,
  draft,
  onRefreshAgents,
  onCreated,
  workspace,
  worktreeApi = worktreeChatApi,
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly refreshing: boolean;
  readonly draft: NewChatDraft;
  readonly onRefreshAgents: () => void;
  readonly onCreated: (chat: ChatSummary) => void;
  readonly workspace?: WorkspaceStore;
  readonly worktreeApi?: WorktreeChatApi;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const organization = useSyncExternalStore(
    workspace?.subscribe ?? noSubscribe,
    workspace?.getSnapshot ?? emptyWorkspace,
    workspace?.getSnapshot ?? emptyWorkspace,
  );
  const group = useId();
  const [folderId, setFolderId] = useState("");
  const [preview, setPreview] = useState<ChatCreatePreview | null>(null);
  const [allowBusy, setAllowBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const folderChoice = useMemo(() => new WorktreeChoice(worktreeApi), [worktreeApi]);
  const worktree = useSyncExternalStore(
    folderChoice.subscribe,
    folderChoice.getSnapshot,
    folderChoice.getSnapshot,
  );
  const [created, setCreated] = useState<Created>({ type: "idle" });
  const openChip = useRef<(() => void) | null>(null);
  const setupExit = useRef<number | null | "closed">("closed");
  const adding = useRef<string | null>(null);
  // Agents whose detection finished while this screen was open settle in once; first paint does not.
  const seen = useRef<ReadonlyMap<string, string> | "waiting" | null>(null);
  const [found, setFound] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    if (agents === null) {
      if (seen.current === null) seen.current = "waiting";
      return;
    }
    const before = seen.current;
    const settled = agents
      .filter(
        (agent) =>
          agent.availability.state === "ready" &&
          (before === "waiting" || (before !== null && before.get(agent.id) === "checking")),
      )
      .map((agent) => agent.id);
    seen.current = new Map(agents.map((agent) => [agent.id, agent.availability.state]));
    if (settled.length > 0) setFound((current) => new Set([...current, ...settled]));
  }, [agents]);
  // The project folder this chat would use: chosen under Projects, or the picked folder's own.
  const folders = organization.data?.projects.flatMap((project) => project.folders) ?? [];
  const picked = state.folder ? folders.find((folder) => folder.path === state.folder) : undefined;
  const knownFolder = folderId || picked?.id || "";
  useEffect(() => {
    let current = true;
    setAllowBusy(false);
    setPreview(null);
    setPreviewError(null);
    if (knownFolder && workspace)
      void workspace.api.preview(knownFolder).then(
        (value) => {
          if (current) setPreview(value);
        },
        (error) => {
          if (current) setPreviewError(errorMessage(error));
        },
      );
    return () => {
      current = false;
    };
  }, [knownFolder, workspace]);
  // A picked folder joins the workspace as its own project at once (as a project is added in the
  // Codex app), so its Git state is reviewed before Create. A failure leaves it to Create.
  const loaded = organization.data !== null;
  useEffect(() => {
    const path = state.folder;
    if (!workspace || !path || folderId || !loaded || picked || adding.current === path) return;
    adding.current = path;
    void workspace
      .perform(() =>
        workspace.api.createProject({
          project: {
            name: projectName(path),
            color: null,
            default_agent: draft.getSnapshot().agentId,
            default_model: null,
          },
          folder: path,
        }),
      )
      .then((project) => {
        const id = project?.folders[0]?.id;
        if (id && draft.getSnapshot().folder === path) setFolderId(id);
      });
  }, [workspace, state.folder, folderId, loaded, picked, draft]);
  const available = (agents ?? []).filter((agent) => agentChoice(agent).enabled);
  const unavailable = (agents ?? []).filter((agent) => !agentChoice(agent).enabled);
  const selected = available.find((agent) => agent.id === state.agentId) ?? null;
  // Rust reviews the worktree for the chosen agent, or the first one that can run until one is.
  const reviewAgent = selected?.id ?? available[0]?.id ?? null;
  useEffect(() => {
    folderChoice.target(workspace && knownFolder ? knownFolder : null, reviewAgent);
  }, [folderChoice, workspace, knownFolder, reviewAgent]);
  // Leaving New chat drops every review on its way.
  useEffect(() => () => folderChoice.target(null, null), [folderChoice]);
  const worktreeMode = worktree.kind === "git" && worktree.options.mode === "worktree";
  const setupTransport = useMemo(
    () =>
      created.type === "setup"
        ? worktreeApi.setupTerminal(created.result.chat.chat.id, created.token)
        : null,
    [created, worktreeApi],
  );
  const finishing = useRef(false);
  /** Starts the agent after its setup had its turn, then opens the chat (or shows what to read). */
  const finishSetup = async (result: WorktreeChatResult) => {
    if (finishing.current) return;
    finishing.current = true;
    setCreated({ type: "starting", result });
    const notes = [...result.warnings];
    const note = setupNote(setupExit.current);
    if (note) notes.push(note);
    try {
      await worktreeApi.start(result.chat.chat.id);
    } catch (error) {
      notes.push(`The agent did not start: ${errorMessage(error)} Start it from the chat.`);
    }
    if (notes.length) setCreated({ type: "done", result, notes });
    else onCreated(result.chat.chat);
  };
  const madeWorktree = (result: WorktreeChatResult, plan: WorktreeChatPlan) => {
    const token = result.setup?.command_token;
    if (token && !result.started) {
      setupExit.current = "closed";
      finishing.current = false;
      setCreated({ type: "setup", result, plan, token });
    } else if (result.warnings.length) setCreated({ type: "done", result, notes: result.warnings });
    else onCreated(result.chat.chat);
  };
  const choiceState = (agent: AgentEntry): ChoiceState =>
    agent.availability.state === "checking"
      ? "detecting"
      : agent.id === state.agentId && state.auth?.state === "sign_in_required"
        ? "sign-in"
        : "ready";
  const note = selected ? downloadNote(selected) : null;
  const ready = selected ? readyLine(selected) : null;
  // A worktree chat never shares the project folder, so only Local waits on its running chats.
  const busy = !worktreeMode && preview !== null && preview.busy_chats.length > 0;
  const finished = created.type === "done";
  const canCreate =
    finished ||
    (created.type === "idle" &&
      selected !== null &&
      (state.folder !== null || folderId !== "") &&
      !organization.busy &&
      !worktree.creating &&
      !state.creating &&
      state.maintenanceBusy !== "update");
  const chosenFolder = preview?.folder.path ?? state.folder;
  const projects = workspace ? (organization.data?.projects ?? []) : [];
  const selectedState = selected ? choiceState(selected) : null;
  return (
    <form
      className="new-chat"
      aria-label="New chat"
      data-testid="new-chat"
      onSubmit={(event) => {
        event.preventDefault();
        if (created.type === "done") {
          onCreated(created.result.chat.chat);
          return;
        }
        if (created.type !== "idle") return;
        if (!workspace) {
          void draft.create().then((chat) => {
            if (chat) onCreated(chat);
          });
          return;
        }
        const agentId = state.agentId;
        void workspace
          .perform(async () => {
            let destination = knownFolder;
            let added = false;
            if (!destination && state.folder) {
              const project = await workspace.api.createProject({
                project: {
                  name: projectName(state.folder),
                  color: null,
                  default_agent: agentId,
                  default_model: null,
                },
                folder: state.folder,
              });
              destination = project.folders[0]?.id ?? "";
              added = true;
              setFolderId(destination);
            }
            if (!destination || !agentId) return null;
            // The latest review decides: a worktree (zero clicks by default) or the folder itself.
            folderChoice.target(destination, agentId);
            const decision = await folderChoice.resolve();
            if (decision.type === "stop") {
              if (folderChoice.getSnapshot().error) openChip.current?.();
              return null;
            }
            if (decision.type === "worktree") {
              // A folder first reviewed by this Create shows its worktree before making one.
              if (added) return null;
              const result = await folderChoice.create(decision.plan);
              return { type: "worktree" as const, result, plan: decision.plan };
            }
            const checked = await workspace.api.preview(destination);
            setPreview(checked);
            if (checked.busy_chats.length > 0 && !allowBusy) return null;
            const entry = await workspace.api.createChat({
              folder_id: destination,
              agent_id: agentId,
              allow_busy_folder: allowBusy,
            });
            return { type: "local" as const, entry };
          })
          .then((made) => {
            if (made?.type === "local") onCreated(made.entry.chat);
            else if (made?.type === "worktree") madeWorktree(made.result, made.plan);
          });
      }}
    >
      <header className="new-chat-hero">
        <Logo className="new-chat-logo" size={40} />
        {/* One display line: the agent and the folder in ink, the connecting words in grey. */}
        <h1 className="new-chat-title">
          {!selected ? (
            <span className="new-chat-ink">What are we working on?</span>
          ) : selectedState === "detecting" ? (
            <>
              Looking for <span className="new-chat-ink">{selected.name}</span>.
            </>
          ) : selectedState === "sign-in" ? (
            <>
              <span className="new-chat-ink">{selected.name}</span> needs you to sign in.
            </>
          ) : (
            <>
              <span className="new-chat-ink">{selected.name}</span> is ready
              {chosenFolder ? (
                <>
                  {" "}
                  in <span className="new-chat-ink">{projectName(chosenFolder)}</span>
                </>
              ) : null}
              .
            </>
          )}
        </h1>
        <p className="new-chat-hint">
          {!selected
            ? "Pick an agent, then a folder."
            : chosenFolder
              ? worktreeMode
                ? "Create starts the session in its own worktree."
                : "Create starts the session in this folder."
              : "Choose the folder it works in."}
        </p>
      </header>
      <div className="new-chat-card">
        <div className="new-chat-row">
          <div className="new-chat-agents" data-testid="new-chat-agent">
            {agents === null ? (
              <span className="new-chat-scan" role="status">
                <PixelLoader size={16} tempo="thinking" />
                Looking for agents
              </span>
            ) : available.length === 0 ? (
              <span className="new-chat-none">No agent can run here yet.</span>
            ) : (
              // Native radios: arrow keys, Tab and the accessible group come from the platform.
              <fieldset className="new-chat-choices">
                <legend className="sr-only">Agent</legend>
                {available.map((agent) => {
                  const checked = agent.id === state.agentId;
                  const choice = choiceState(agent);
                  return (
                    <label
                      key={agent.id}
                      className="new-chat-agent"
                      data-state={choice}
                      data-found={found.has(agent.id) ? "" : undefined}
                    >
                      <input
                        type="radio"
                        name={group}
                        value={agent.id}
                        checked={checked}
                        aria-label={`${agent.name}, ${STATE_LABEL[choice]}`}
                        onChange={() => draft.chooseAgent(agent.id)}
                      />
                      <AgentMark
                        agent={agent.id}
                        size={24}
                        state={
                          choice === "detecting"
                            ? "thinking"
                            : choice === "sign-in"
                              ? "waiting"
                              : "idle"
                        }
                      />
                      <span className="new-chat-agent-name">{agent.name}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </div>
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon g-button-28 new-chat-refresh"
            data-testid="new-chat-refresh"
            aria-label={refreshing ? "Refreshing…" : "Refresh agents"}
            title="Refresh agents"
            disabled={refreshing}
            onClick={onRefreshAgents}
          >
            {refreshing ? (
              <PixelLoader size={12} tempo="thinking" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="new-chat-folder">
          <Folder className="new-chat-folder-icon" size={16} aria-hidden="true" />
          <span
            className="new-chat-path"
            data-testid="new-chat-folder"
            data-test-folder={state.folder ?? ""}
            data-empty={chosenFolder ? undefined : ""}
            title={chosenFolder ?? undefined}
          >
            {chosenFolder ?? "No folder chosen"}
          </span>
          {projects.length > 0 ? (
            <select
              className="g-select new-chat-projects"
              aria-label="Project folder"
              value={knownFolder}
              onChange={(event) => {
                setFolderId(event.currentTarget.value);
                const project = organization.data?.projects.find((item) =>
                  item.folders.some((folder) => folder.id === event.currentTarget.value),
                );
                if (project?.default_agent) draft.chooseAgent(project.default_agent);
              }}
            >
              <option value="">Projects</option>
              {projects.map((project) => (
                <optgroup key={project.id} label={project.name}>
                  {project.folders.map((folder) => (
                    <option
                      key={folder.id}
                      value={folder.id}
                      disabled={folder.folder_state !== "ok"}
                    >
                      {folder.display_name}
                      {folder.folder_state !== "ok" ? " (unavailable on this device)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="g-button g-button-outline"
            data-testid="new-chat-pick-folder"
            disabled={state.picking}
            onClick={() => {
              setFolderId("");
              void draft.chooseFolder();
            }}
          >
            {state.picking ? "Choosing…" : "Choose folder"}
          </button>
          <button
            type="submit"
            className="g-button g-button-primary"
            data-testid="new-chat-create"
            disabled={!canCreate || (busy && !allowBusy && !finished)}
          >
            {finished
              ? "Open chat"
              : created.type === "setup"
                ? "Setting up…"
                : created.type === "starting"
                  ? "Starting…"
                  : state.creating || worktree.creating
                    ? "Creating…"
                    : "Create"}
          </button>
        </div>
      </div>
      {/* Under the card: where it works, then the agent's facts, consent, warnings and errors. */}
      <div className="new-chat-below">
        {created.type === "idle" ? (
          <WorktreeChip
            view={worktree}
            busyChats={preview?.busy_chats.length ?? 0}
            openRef={openChip}
            onPropose={(change, field) => folderChoice.propose(change, field)}
            onClearError={() => folderChoice.clearError()}
          />
        ) : (
          <SetupStatus created={created} agentName={selected?.name ?? "The agent"} />
        )}
        {preview && busy ? (
          <div className="new-chat-busy">
            <strong>This folder has active work</strong>
            <p>{preview.busy_chats.map((chat) => chat.title ?? chat.agent_name).join(", ")}</p>
            <label>
              <input
                type="checkbox"
                checked={allowBusy}
                onChange={(event) => setAllowBusy(event.currentTarget.checked)}
              />
              Start another chat in this folder. Agents may edit the same files.
            </label>
          </div>
        ) : null}
        {note !== null ? <p className="new-chat-note">{note}</p> : null}
        {(previewError ?? organization.error) ? (
          <p role="alert" className="new-chat-error">
            {previewError ?? organization.error}
          </p>
        ) : null}
        {state.error !== null ? (
          <p role="alert" className="new-chat-error" data-testid="new-chat-error">
            {state.error}
          </p>
        ) : null}
        {selected ? (
          <details className="new-chat-more">
            <summary>
              <span className="new-chat-more-line" data-state={selectedState ?? undefined}>
                {ready}
              </span>
              <span className="new-chat-more-label">Details</span>
            </summary>
            <div className="new-chat-more-body">
              {selected.description ? <p>{selected.description}</p> : null}
              {selected.installation ? (
                <InstallationStatus installation={selected.installation} />
              ) : null}
              {selected.latest_release?.version ? (
                <small className="ui-muted">
                  Latest on {selected.latest_release.source}: {selected.latest_release.version}
                  {selected.latest_release.stale ? " (cached; refresh unavailable)" : null}
                </small>
              ) : null}
              {selected.installation ? (
                <section className="new-chat-maintenance" aria-label="Agent maintenance">
                  {state.maintenanceBusy === "checking" ? (
                    <small className="ui-muted">Checking available actions…</small>
                  ) : null}
                  {state.maintenance?.auth_status ||
                  state.maintenance?.update_unavailable === null ? (
                    <div className="new-chat-actions">
                      {state.maintenance?.auth_status ? (
                        <button
                          type="button"
                          className="g-button g-button-outline g-button-28"
                          disabled={state.maintenanceBusy !== null}
                          onClick={() => void draft.checkAuth()}
                        >
                          {state.maintenanceBusy === "auth" ? "Checking sign-in…" : "Check sign-in"}
                        </button>
                      ) : null}
                      {state.maintenance?.update_unavailable === null ? (
                        <button
                          type="button"
                          className="g-button g-button-outline g-button-28"
                          disabled={state.maintenanceBusy !== null || state.creating}
                          onClick={() => void draft.updateAgent().then(() => onRefreshAgents())}
                        >
                          {state.maintenanceBusy === "update" ? "Updating agent…" : "Update agent"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {state.maintenance?.update_unavailable ? (
                    <small className="ui-muted">{state.maintenance.update_unavailable}</small>
                  ) : null}
                  {state.auth ? (
                    <span
                      role="status"
                      className="new-chat-auth"
                      data-state={state.auth.state === "sign_in_required" ? "sign-in" : undefined}
                    >
                      {authStatusText(state.auth)}
                    </span>
                  ) : null}
                  {state.maintenanceMessage ? (
                    <span role="status">{state.maintenanceMessage}</span>
                  ) : null}
                  {state.maintenanceError ? (
                    <span role="alert" className="ui-error">
                      {state.maintenanceError}
                    </span>
                  ) : null}
                </section>
              ) : null}
            </div>
          </details>
        ) : null}
        {unavailable.length > 0 ? (
          <details className="new-chat-more">
            <summary>
              <span className="new-chat-more-label">Other agents</span>
              <span className="new-chat-more-count">{unavailable.length}</span>
            </summary>
            <ul className="new-chat-unavailable">
              {unavailable.map((agent) => (
                <li key={agent.id} data-test-unavailable={agent.id}>
                  <AgentMark
                    agent={agent.id}
                    size={24}
                    ghost={agent.availability.state === "missing"}
                    state={agent.availability.state === "broken" ? "error" : "idle"}
                    label={agent.availability.state === "broken" ? "Failed" : "Not available"}
                  />
                  <span>
                    <strong>{agent.name}</strong>
                    <span>{agentChoice(agent).reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {created.type === "setup" && setupTransport ? (
        <TerminalSheet
          agentId="worktree-setup"
          agentName={created.result.worktree.branch}
          purpose="setup"
          transport={setupTransport}
          review={<SetupReview result={created.result} plan={created.plan} />}
          onFinished={(exit) => {
            setupExit.current = exit;
            // A clean setup goes straight on to the agent; a failed one stays open to be read.
            if (exit === 0) void finishSetup(created.result);
          }}
          onClose={() => void finishSetup(created.result)}
        />
      ) : null}
    </form>
  );
}

/**
 * Where a worktree chat stands after Create: its setup command waiting in the owned terminal, the
 * agent starting, or the chat ready with what is worth reading before it opens.
 */
export function SetupStatus({
  created,
  agentName,
}: {
  readonly created: Exclude<Created, { type: "idle" }>;
  readonly agentName: string;
}) {
  const { result } = created;
  const branch = <code className="new-chat-branch">{result.worktree.branch}</code>;
  const copied = result.setup?.copied.length ?? 0;
  if (created.type === "done")
    return (
      <div className="new-chat-created" data-testid="new-chat-created">
        <strong className="new-chat-created-title">{branch} is ready in its own folder</strong>
        {created.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    );
  return (
    <div className="new-chat-worktree" data-testid="new-chat-setup" data-test-phase={created.type}>
      <p className="new-chat-worktree-status" role="status">
        <PixelLoader size={12} tempo="tool" />
        <span className="new-chat-worktree-status-text">
          {created.type === "setup" ? (
            <>Setting up {branch}</>
          ) : (
            <>
              Starting {agentName} in {branch}
            </>
          )}
        </span>
      </p>
      {created.type === "setup" ? (
        <p className="new-chat-worktree-note">
          {copied ? `Copied ${copied} setup ${copied === 1 ? "file" : "files"}. ` : ""}
          {agentName} starts once the setup command has run.
        </p>
      ) : null}
    </div>
  );
}

/** The reviewed setup command, as the terminal sheet's rows: where it runs, what it runs. */
export function SetupReview({
  result,
  plan,
}: {
  readonly result: WorktreeChatResult;
  readonly plan: WorktreeChatPlan;
}) {
  const command = plan.setup?.command ?? null;
  const copied = result.setup?.copied ?? [];
  return (
    <dl className="new-chat-setup-review" aria-label="Setup command review">
      <dt>Folder</dt>
      <dd>
        <code className="new-chat-setup-value">{result.worktree.path}</code>
      </dd>
      {copied.length ? (
        <>
          <dt>Copied</dt>
          <dd>
            {copied.map((path) => (
              <code key={path} className="new-chat-setup-value">
                {path}
              </code>
            ))}
          </dd>
        </>
      ) : null}
      {command ? (
        <>
          <dt>Command</dt>
          <dd>
            <code className="new-chat-setup-value">
              {[command.program, ...command.args].join(" ")}
            </code>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

import { AgentMark, Logo, PixelLoader } from "@auracode/ui/graphite";
import { Check, ChevronDown, Folder, RefreshCw, Search } from "lucide-react";
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
  ManagedWorktree,
  WorktreeChatPlan,
  WorktreeChatResult,
} from "../../bindings";
import { agentLineup } from "../../lib/chat/agentLineup";
import { agentChoice, type NewChatDraft } from "../../lib/chat/appStore";
import { projectSourceFolder } from "../../lib/chat/newChatContext";
import { WorktreeChoice } from "../../lib/chat/worktreeChoice";
import { errorMessage } from "../../lib/errors";
import { agentVersion, builtInPath } from "../../lib/format";
import { sameFolder } from "../../lib/gitWorkspace";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { type WorktreeChatApi, worktreeChatApi } from "../../lib/worktreeChat";
import { type WorktreeRecoveryApi, worktreeRecoveryApi } from "../../lib/worktreeRecovery";
import { projectName } from "./ChatList";
import { closePopover, Popover } from "./Popover";
import { WorktreeChip } from "./WorktreeChip";
import { WorktreeRecoveryList } from "./WorktreeRecoveryList";
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
    case "ready": {
      const path = builtInPath(agent.availability.path);
      return agent.availability.version === null
        ? path
        : `${agentVersion(agent.name, agent.availability.version)} (${path})`;
    }
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
  recoveryApi = worktreeRecoveryApi,
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly refreshing: boolean;
  readonly draft: NewChatDraft;
  readonly onRefreshAgents: () => void;
  readonly onCreated: (chat: ChatSummary) => void;
  readonly workspace?: WorkspaceStore;
  readonly worktreeApi?: WorktreeChatApi;
  readonly recoveryApi?: WorktreeRecoveryApi;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const organization = useSyncExternalStore(
    workspace?.subscribe ?? noSubscribe,
    workspace?.getSnapshot ?? emptyWorkspace,
    workspace?.getSnapshot ?? emptyWorkspace,
  );
  const group = useId();
  // Null keeps automatic project prefill separate from an explicit choice, including clearing it.
  const [folderId, setFolderId] = useState<string | null>(null);
  const [agentQuery, setAgentQuery] = useState("");
  const [retained, setRetained] = useState<ManagedWorktree[]>([]);
  const [retainedLoaded, setRetainedLoaded] = useState(!workspace);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    void recoveryRevision;
    if (!workspace) return;
    setRetainedLoaded(false);
    let current = true;
    void recoveryApi.list(null).then(
      (records) => {
        if (current) {
          setRetained(records);
          setRetainedLoaded(true);
          setRecoveryError(null);
        }
      },
      (error) => {
        if (current) setRecoveryError(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [workspace, recoveryApi, recoveryRevision]);
  const [preview, setPreview] = useState<ChatCreatePreview | null>(null);
  const [allowBusy, setAllowBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const folderChoice = useMemo(() => new WorktreeChoice(worktreeApi), [worktreeApi]);
  const worktree = useSyncExternalStore(
    folderChoice.subscribe,
    folderChoice.getSnapshot,
    folderChoice.getSnapshot,
  );
  const openChip = useRef<(() => void) | null>(null);
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
  const sourceFolder = (folder: { path: string | null }) =>
    !folder.path || !retained.some((record) => sameFolder(record.path, folder.path as string));
  const folders =
    organization.data?.projects
      .filter((project) => !draft.context || project.id === draft.context.projectId)
      .flatMap((project) => project.folders)
      .filter(sourceFolder) ?? [];
  const picked = state.folder ? folders.find((folder) => folder.path === state.folder) : undefined;
  const automaticFolder = retainedLoaded
    ? projectSourceFolder(draft.context, organization.data, retained)
    : draft.context?.folderId;
  const requestedFolder = folderId ?? (state.folder ? "" : automaticFolder) ?? "";
  const knownFolder =
    (folders.some((folder) => folder.id === requestedFolder) ? requestedFolder : "") ||
    picked?.id ||
    "";
  const managedPicked =
    !knownFolder && state.folder
      ? retained.find((record) => sameFolder(record.path, state.folder as string))
      : undefined;
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
    if (
      !workspace ||
      !path ||
      folderId ||
      !loaded ||
      !retainedLoaded ||
      managedPicked ||
      picked ||
      adding.current === path
    )
      return;
    adding.current = path;
    void workspace
      .perform(async () => {
        if (draft.context) return workspace.api.addFolder(draft.context.projectId, path);
        const project = await workspace.api.createProject({
          project: {
            name: projectName(path),
            color: null,
            default_agent: draft.getSnapshot().agentId,
            default_model: null,
          },
          folder: path,
        });
        return project.folders[0] ?? null;
      })
      .then((folder) => {
        const id = folder?.id;
        if (id && draft.getSnapshot().folder === path) setFolderId(id);
      });
  }, [workspace, state.folder, folderId, loaded, retainedLoaded, managedPicked, picked, draft]);
  // The one lineup every agent list reads, so "Other agents" counts the same everywhere.
  const { usable: available, others: unavailable } = agentLineup(agents ?? []);
  const selected = available.find((agent) => agent.id === state.agentId) ?? null;
  // Rust reviews the worktree for the chosen agent, or the first one that can run until one is.
  const reviewAgent = selected?.id ?? available[0]?.id ?? null;
  useEffect(() => {
    folderChoice.target(workspace && knownFolder ? knownFolder : null, reviewAgent);
  }, [folderChoice, workspace, knownFolder, reviewAgent]);
  // Leaving New chat drops every review on its way.
  useEffect(() => () => folderChoice.target(null, null), [folderChoice]);
  const worktreeMode = worktree.kind === "git" && worktree.options.mode === "worktree";
  // Rust persisted setup admission before exposing the chat. Its normal composer remains usable.
  const madeWorktree = (result: WorktreeChatResult, _plan: WorktreeChatPlan) => {
    onCreated(result.chat.chat);
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
  const canCreate =
    selected !== null &&
    (!workspace || retainedLoaded) &&
    !managedPicked &&
    (state.folder !== null || knownFolder !== "") &&
    !organization.busy &&
    !worktree.creating &&
    !state.creating &&
    state.maintenanceBusy !== "update";
  const chosenFolder =
    preview?.folder.path ??
    folders.find((folder) => folder.id === knownFolder)?.path ??
    state.folder;
  const projects = workspace
    ? (organization.data?.projects ?? [])
        .filter((project) => !draft.context || project.id === draft.context.projectId)
        .map((project) => ({ ...project, folders: project.folders.filter(sourceFolder) }))
        .filter((project) => project.folders.length > 0)
    : [];
  const selectedProject = projects.find((project) =>
    project.folders.some((folder) => folder.id === knownFolder),
  );
  const recoveries = retained.filter(
    (record) =>
      (!selectedProject ||
        selectedProject.folders.some(
          (folder) => folder.path && sameFolder(folder.path, record.source),
        )) &&
      (!organization.data?.chats.some((chat) => chat.chat.id === record.chat_id) ||
        !["ready", "retired"].includes(record.state)),
  );
  const selectedState = selected ? choiceState(selected) : null;
  return (
    <form
      className="new-chat"
      aria-label="New chat"
      data-testid="new-chat"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate || (busy && !allowBusy)) return;
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
              if (draft.context) {
                const folder = await workspace.api.addFolder(draft.context.projectId, state.folder);
                destination = folder.id;
              } else {
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
              }
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
        <div className="new-chat-heading">
          <Logo className="new-chat-logo" size={24} />
          <h1 className="new-chat-title">New chat</h1>
        </div>
        <p className="new-chat-hint">
          {draft.context
            ? `Start a session in ${draft.context.projectName}.`
            : "Choose an agent and a folder to work in."}
        </p>
      </header>
      <div className="new-chat-card">
        <div className="new-chat-row">
          <span className="new-chat-field-label">Agent</span>
          <div className="new-chat-agents" data-testid="new-chat-agent">
            {agents === null ? (
              <span className="new-chat-scan" role="status">
                <span className="new-chat-scan-pulse" aria-hidden="true">
                  <span className="ui-pulse" />
                </span>
                Looking for agents
              </span>
            ) : available.length === 0 ? (
              <span className="new-chat-none">No agent can run here yet.</span>
            ) : (
              <Popover
                label="Choose agent"
                triggerLabel={`${selected?.name ?? "Select an agent"}. Choose agent`}
                className="new-chat-agent-picker"
                trigger={
                  <>
                    {selected ? <AgentMark agent={selected.id} size={20} /> : null}
                    <span className="new-chat-selected-name">
                      {selected?.name ?? "Select an agent"}
                    </span>
                    <ChevronDown size={14} />
                  </>
                }
                onOpenChange={(open) => {
                  if (!open) setAgentQuery("");
                }}
              >
                <label className="new-chat-agent-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    className="g-input"
                    type="search"
                    aria-label="Search agents"
                    placeholder="Search agents…"
                    value={agentQuery}
                    onChange={(event) => setAgentQuery(event.currentTarget.value)}
                  />
                </label>
                <fieldset className="new-chat-choices">
                  <legend className="sr-only">Agent</legend>
                  {available
                    .filter((agent) => agent.name.toLowerCase().includes(agentQuery.toLowerCase()))
                    .map((agent) => {
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
                            onChange={(event) => {
                              draft.chooseAgent(agent.id);
                              const popup = event.currentTarget.closest("details");
                              closePopover(event.currentTarget);
                              popup?.querySelector("summary")?.focus();
                            }}
                          />
                          {/* Still looked for: the mark waits dimmed inside a soft circular pulse. */}
                          <span className="new-chat-agent-mark">
                            <AgentMark
                              agent={agent.id}
                              size={24}
                              state={choice === "sign-in" ? "waiting" : "idle"}
                            />
                          </span>
                          <span className="new-chat-agent-name">{agent.name}</span>
                          <small>{STATE_LABEL[choice]}</small>
                          {checked ? <Check size={14} aria-hidden="true" /> : null}
                        </label>
                      );
                    })}
                </fieldset>
                {!available.some((agent) =>
                  agent.name.toLowerCase().includes(agentQuery.toLowerCase()),
                ) ? (
                  <p className="chat-picker-empty">No matching agents.</p>
                ) : null}
              </Popover>
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
          <span className="new-chat-field-label">Folder</span>
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
                // The project's agent fills an empty choice only: an agent already picked here
                // stays picked when the folder changes.
                if (project?.default_agent && draft.getSnapshot().agentId === null)
                  draft.chooseAgent(project.default_agent);
              }}
            >
              <option value="">{draft.context ? "Select folder" : "Projects"}</option>
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
              void draft.chooseFolder().then((folder) => {
                if (folder !== null) setFolderId("");
              });
            }}
          >
            {state.picking ? "Choosing…" : "Choose folder"}
          </button>
        </div>
        <div className="new-chat-submit">
          <span>
            {chosenFolder
              ? worktreeMode
                ? "Starts in a separate worktree"
                : "Starts in this folder"
              : "Select a folder to continue"}
          </span>
          <button
            type="submit"
            className="g-button g-button-primary"
            data-testid="new-chat-create"
            disabled={!canCreate || (busy && !allowBusy)}
          >
            {state.creating || worktree.creating ? "Starting…" : "Start chat"}
          </button>
        </div>
      </div>
      {/* Under the card: where it works, then the agent's facts, consent, warnings and errors. */}
      <div className="new-chat-below">
        {managedPicked ? (
          <p className="ui-error" role="alert">
            This folder is a managed worktree on {managedPicked.branch}. Choose its original project
            folder: {managedPicked.source}.
          </p>
        ) : null}
        {recoveryError ? (
          <p role="alert" className="ui-error">
            Could not load retained worktrees: {recoveryError}
          </p>
        ) : null}
        <WorktreeRecoveryList
          records={recoveries}
          api={recoveryApi}
          onChanged={() => setRecoveryRevision((value) => value + 1)}
        />
        <WorktreeChip
          view={worktree}
          busyChats={preview?.busy_chats.length ?? 0}
          openRef={openChip}
          onPropose={(change, field) => folderChoice.propose(change, field)}
          onClearError={() => folderChoice.clearError()}
        />
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
    </form>
  );
}

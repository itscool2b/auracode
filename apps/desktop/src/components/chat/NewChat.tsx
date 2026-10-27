import { AgentMark, Logo } from "@auracode/ui/graphite";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type {
  AgentAuthStatus,
  AgentEntry,
  AgentInstallation,
  ChatCreatePreview,
  ChatSummary,
} from "../../bindings";
import { agentChoice, type NewChatDraft } from "../../lib/chat/appStore";
import { errorMessage } from "../../lib/errors";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { projectName } from "./ChatList";

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

/**
 * New chat: an agent (those that cannot run here are disabled, with their reason), the download
 * note when the first start downloads an adapter, Refresh agents, the folder from the system
 * picker, and Create. Creating the chat starts its agent; errors show inline.
 */
export function NewChat({
  agents,
  refreshing,
  draft,
  onRefreshAgents,
  onCreated,
  workspace,
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly refreshing: boolean;
  readonly draft: NewChatDraft;
  readonly onRefreshAgents: () => void;
  readonly onCreated: (chat: ChatSummary) => void;
  readonly workspace?: WorkspaceStore;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const organization = useSyncExternalStore(
    workspace?.subscribe ?? noSubscribe,
    workspace?.getSnapshot ?? emptyWorkspace,
    workspace?.getSnapshot ?? emptyWorkspace,
  );
  const [folderId, setFolderId] = useState("");
  const [preview, setPreview] = useState<ChatCreatePreview | null>(null);
  const [allowBusy, setAllowBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setAllowBusy(false);
    setPreview(null);
    setPreviewError(null);
    if (folderId && workspace)
      void workspace.api.preview(folderId).then(
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
  }, [folderId, workspace]);
  const agentId = useId();
  const selected = agents?.find((agent) => agent.id === state.agentId) ?? null;
  const unavailable = (agents ?? []).filter((agent) => !agentChoice(agent).enabled);
  const note = selected ? downloadNote(selected) : null;
  const ready = selected ? readyLine(selected) : null;
  const canCreate =
    selected !== null &&
    agentChoice(selected).enabled &&
    (state.folder !== null || folderId !== "") &&
    !organization.busy &&
    !state.creating &&
    state.maintenanceBusy !== "update";
  const chosenFolder = preview?.folder.path ?? state.folder;
  return (
    <form
      className="chat-new-form"
      aria-label="New chat"
      data-testid="new-chat"
      onSubmit={(event) => {
        event.preventDefault();
        if (!workspace) {
          void draft.create().then((chat) => {
            if (chat) onCreated(chat);
          });
          return;
        }
        void workspace
          .perform(async () => {
            let destination = folderId;
            if (!destination && state.folder) {
              const existing = organization.data?.projects
                .flatMap((project) => project.folders)
                .find((folder) => folder.path === state.folder);
              if (existing) destination = existing.id;
              else {
                const project = await workspace.api.createProject({
                  project: {
                    name: projectName(state.folder),
                    color: null,
                    default_agent: state.agentId,
                    default_model: null,
                  },
                  folder: state.folder,
                });
                destination = project.folders[0]?.id ?? "";
              }
              setFolderId(destination);
            }
            if (!destination || !state.agentId) return null;
            const checked = await workspace.api.preview(destination);
            setPreview(checked);
            if (checked.busy_chats.length > 0 && !allowBusy) return null;
            return workspace.api.createChat({
              folder_id: destination,
              agent_id: state.agentId,
              allow_busy_folder: allowBusy,
            });
          })
          .then((entry) => {
            if (entry) onCreated(entry.chat);
          });
      }}
    >
      <div className="chat-welcome">
        {/* The chosen agent's mark; before one is chosen, the auracode glyph. Both stay still. */}
        {selected ? (
          <AgentMark
            agent={selected.id}
            size={40}
            label={`${selected.name}, ready for a new chat`}
          />
        ) : (
          <Logo className="chat-welcome-glyph" size={40} label="auracode" />
        )}
        {/* One two-tone sentence (6.13): the agent and the project in ink, the rest in grey. */}
        <h1>
          {selected ? (
            <>
              <span className="chat-welcome-fg">{selected.name}</span> is ready
              {chosenFolder ? (
                <>
                  {" "}
                  in <span className="chat-welcome-fg">{projectName(chosenFolder)}</span>
                </>
              ) : null}
              .
            </>
          ) : (
            <span className="chat-welcome-fg">What are we working on?</span>
          )}
          <span className="chat-welcome-next">
            {!selected
              ? "Choose an agent and a folder."
              : chosenFolder
                ? "Create the chat to start."
                : "Choose a folder to begin."}
          </span>
        </h1>
      </div>
      <div className="chat-new-card">
        <div className="ui-field">
          <label htmlFor={agentId}>Agent</label>
          <div className="ui-row">
            <select
              id={agentId}
              className="ui-select"
              data-testid="new-chat-agent"
              value={state.agentId ?? ""}
              onChange={(event) => draft.chooseAgent(event.currentTarget.value)}
            >
              <option value="" disabled>
                {agents === null ? "Looking for agents…" : "Choose an agent"}
              </option>
              {(agents ?? []).map((agent) => {
                const choice = agentChoice(agent);
                return (
                  <option key={agent.id} value={agent.id} disabled={!choice.enabled}>
                    {choice.reason === null ? agent.name : `${agent.name}: ${choice.reason}`}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="g-button"
              data-testid="new-chat-refresh"
              disabled={refreshing}
              onClick={onRefreshAgents}
            >
              {refreshing ? "Refreshing…" : "Refresh agents"}
            </button>
          </div>
          <details className="chat-new-details">
            <summary>Agent details and sign-in</summary>
            {selected ? <span className="ui-muted">{selected.description}</span> : null}
            {ready !== null ? <span className="ui-muted ui-mono">{ready}</span> : null}
            {selected?.installation ? (
              <InstallationStatus installation={selected.installation} />
            ) : null}
            {selected?.latest_release?.version ? (
              <small className="ui-muted">
                Latest on {selected.latest_release.source}: {selected.latest_release.version}
                {selected.latest_release.stale ? " (cached; refresh unavailable)" : null}
              </small>
            ) : null}
            {selected?.installation ? (
              <section className="ui-field" aria-label="Agent maintenance">
                {state.maintenanceBusy === "checking" ? (
                  <small className="ui-muted">Checking available actions…</small>
                ) : null}
                <div className="ui-row">
                  {state.maintenance?.auth_status ? (
                    <button
                      type="button"
                      className="g-button"
                      disabled={state.maintenanceBusy !== null}
                      onClick={() => void draft.checkAuth()}
                    >
                      {state.maintenanceBusy === "auth" ? "Checking sign-in…" : "Check sign-in"}
                    </button>
                  ) : null}
                  {state.maintenance?.update_unavailable === null ? (
                    <button
                      type="button"
                      className="g-button"
                      disabled={state.maintenanceBusy !== null || state.creating}
                      onClick={() => void draft.updateAgent().then(() => onRefreshAgents())}
                    >
                      {state.maintenanceBusy === "update" ? "Updating agent…" : "Update agent"}
                    </button>
                  ) : null}
                </div>
                {state.maintenance?.update_unavailable ? (
                  <small className="ui-muted">{state.maintenance.update_unavailable}</small>
                ) : null}
                {state.auth ? (
                  <span role="status" className="ui-muted">
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
          </details>
          {note !== null ? <span>{note}</span> : null}
        </div>
        {unavailable.length > 0 ? (
          <details className="chat-new-details">
            <summary>Other agents</summary>
            <ul className="chat-unavailable">
              {unavailable.map((agent) => (
                <li key={agent.id}>
                  {agent.name}: {agentChoice(agent).reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="ui-field">
          <span>Folder</span>
          {workspace && (organization.data?.projects.length ?? 0) > 0 ? (
            <select
              className="ui-select"
              aria-label="Project folder"
              value={folderId}
              onChange={(event) => {
                setFolderId(event.currentTarget.value);
                const project = organization.data?.projects.find((item) =>
                  item.folders.some((folder) => folder.id === event.currentTarget.value),
                );
                if (project?.default_agent) draft.chooseAgent(project.default_agent);
              }}
            >
              <option value="">Choose a different folder…</option>
              {organization.data?.projects.map((project) => (
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
          <div className="ui-row">
            <button
              type="button"
              className="g-button"
              data-testid="new-chat-pick-folder"
              disabled={state.picking}
              onClick={() => {
                setFolderId("");
                void draft.chooseFolder();
              }}
            >
              {state.picking ? "Choosing…" : "Choose folder"}
            </button>
            <span
              className="ui-mono"
              data-testid="new-chat-folder"
              data-test-folder={state.folder ?? ""}
            >
              {preview?.folder.path ?? state.folder ?? "No folder chosen"}
            </span>
          </div>
        </div>
      </div>
      {preview && preview.busy_chats.length > 0 ? (
        <div className="chat-busy-warning">
          <strong>This folder has active work</strong>
          <p>{preview.busy_chats.map((chat) => chat.title ?? chat.agent_name).join(", ")}</p>
          <label>
            <input
              type="checkbox"
              checked={allowBusy}
              onChange={(event) => setAllowBusy(event.currentTarget.checked)}
            />{" "}
            Start another chat in this folder. Agents may edit the same files.
          </label>
        </div>
      ) : null}
      {(previewError ?? organization.error) ? (
        <p role="alert" className="ui-error">
          {previewError ?? organization.error}
        </p>
      ) : null}
      <div className="ui-row chat-new-submit">
        <button
          type="submit"
          className="g-button g-button-primary"
          data-testid="new-chat-create"
          disabled={!canCreate || (preview !== null && preview.busy_chats.length > 0 && !allowBusy)}
        >
          {state.creating ? "Creating…" : "Create"}
        </button>
        {state.error !== null ? (
          <span role="alert" className="ui-error" data-testid="new-chat-error">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

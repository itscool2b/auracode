import { AgentMark, Logo, PixelLoader } from "@auracode/ui/graphite";
import { Folder, RefreshCw } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
 * New chat, after Grok's start screen: the logo, one sentence, and one composer card holding the
 * agents that can run here (each showing whether it is still being looked for, ready, or waiting
 * on a sign-in), the folder, and Create. Agents that cannot run here wait under "Other agents"
 * with their reason. Creating the chat starts its agent; errors show under the card.
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
  const group = useId();
  const [folderId, setFolderId] = useState("");
  const [preview, setPreview] = useState<ChatCreatePreview | null>(null);
  const [allowBusy, setAllowBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
  const available = (agents ?? []).filter((agent) => agentChoice(agent).enabled);
  const unavailable = (agents ?? []).filter((agent) => !agentChoice(agent).enabled);
  const selected = available.find((agent) => agent.id === state.agentId) ?? null;
  const choiceState = (agent: AgentEntry): ChoiceState =>
    agent.availability.state === "checking"
      ? "detecting"
      : agent.id === state.agentId && state.auth?.state === "sign_in_required"
        ? "sign-in"
        : "ready";
  const note = selected ? downloadNote(selected) : null;
  const ready = selected ? readyLine(selected) : null;
  const busy = preview !== null && preview.busy_chats.length > 0;
  const canCreate =
    selected !== null &&
    (state.folder !== null || folderId !== "") &&
    !organization.busy &&
    !state.creating &&
    state.maintenanceBusy !== "update";
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
              ? "Create starts the session in this folder."
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
              value={folderId}
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
            disabled={!canCreate || (busy && !allowBusy)}
          >
            {state.creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
      {/* Under the card: the chosen agent's facts, consent, warnings and errors, quietest first. */}
      <div className="new-chat-below">
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

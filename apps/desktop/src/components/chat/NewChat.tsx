import { useId, useSyncExternalStore } from "react";
import type { AgentAuthStatus, AgentEntry, AgentInstallation, ChatSummary } from "../../bindings";
import { agentChoice, type NewChatDraft } from "../../lib/chat/appStore";

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
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly refreshing: boolean;
  readonly draft: NewChatDraft;
  readonly onRefreshAgents: () => void;
  readonly onCreated: (chat: ChatSummary) => void;
}) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const agentId = useId();
  const selected = agents?.find((agent) => agent.id === state.agentId) ?? null;
  const unavailable = (agents ?? []).filter((agent) => !agentChoice(agent).enabled);
  const note = selected ? downloadNote(selected) : null;
  const ready = selected ? readyLine(selected) : null;
  const canCreate =
    selected !== null &&
    agentChoice(selected).enabled &&
    state.folder !== null &&
    !state.creating &&
    state.maintenanceBusy !== "update";
  return (
    <form
      className="chat-new-form"
      aria-label="New chat"
      data-testid="new-chat"
      onSubmit={(event) => {
        event.preventDefault();
        void draft.create().then((chat) => {
          if (chat) onCreated(chat);
        });
      }}
    >
      <h1>New chat</h1>
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
            className="ui-button"
            data-testid="new-chat-refresh"
            disabled={refreshing}
            onClick={onRefreshAgents}
          >
            {refreshing ? "Refreshing…" : "Refresh agents"}
          </button>
        </div>
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
                  className="ui-button"
                  disabled={state.maintenanceBusy !== null}
                  onClick={() => void draft.checkAuth()}
                >
                  {state.maintenanceBusy === "auth" ? "Checking sign-in…" : "Check sign-in"}
                </button>
              ) : null}
              {state.maintenance?.update_unavailable === null ? (
                <button
                  type="button"
                  className="ui-button"
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
        {note !== null ? <span>{note}</span> : null}
      </div>
      {unavailable.length > 0 ? (
        <section aria-label="Unavailable agents">
          <p className="ui-muted">Not available here:</p>
          <ul className="chat-unavailable">
            {unavailable.map((agent) => (
              <li key={agent.id}>
                {agent.name}: {agentChoice(agent).reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="ui-field">
        <span>Folder</span>
        <div className="ui-row">
          <button
            type="button"
            className="ui-button"
            data-testid="new-chat-pick-folder"
            disabled={state.picking}
            onClick={() => void draft.chooseFolder()}
          >
            {state.picking ? "Choosing…" : "Choose folder"}
          </button>
          <span
            className="ui-mono"
            data-testid="new-chat-folder"
            data-test-folder={state.folder ?? ""}
          >
            {state.folder ?? "No folder chosen"}
          </span>
        </div>
      </div>
      <div className="ui-row">
        <button
          type="submit"
          className="ui-button"
          data-kind="primary"
          data-testid="new-chat-create"
          disabled={!canCreate}
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

import { useId, useSyncExternalStore } from "react";
import type { AgentEntry, ChatSummary } from "../../bindings";
import { agentChoice, type NewChatDraft } from "../../lib/chat/appStore";

/** The download consent sentence of an agent whose first start downloads its adapter. */
export function downloadNote(agent: AgentEntry): string | null {
  if (!agent.needs_download) return null;
  // `launch` reads "<package> <version> with your <binary>" for npm adapters.
  const what = agent.launch.split(" with your ")[0] || agent.launch;
  return `Creating this chat downloads ${what} from npm (one time).`;
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
    selected !== null && agentChoice(selected).enabled && state.folder !== null && !state.creating;
  return (
    <form
      className="chat-new-form"
      aria-label="New chat"
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
            disabled={refreshing}
            onClick={onRefreshAgents}
          >
            {refreshing ? "Refreshing…" : "Refresh agents"}
          </button>
        </div>
        {selected ? <span className="ui-muted">{selected.description}</span> : null}
        {ready !== null ? <span className="ui-muted ui-mono">{ready}</span> : null}
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
            disabled={state.picking}
            onClick={() => void draft.chooseFolder()}
          >
            {state.picking ? "Choosing…" : "Choose folder"}
          </button>
          <span className="ui-mono">{state.folder ?? "No folder chosen"}</span>
        </div>
      </div>
      <div className="ui-row">
        <button type="submit" className="ui-button" data-kind="primary" disabled={!canCreate}>
          {state.creating ? "Creating…" : "Create"}
        </button>
        {state.error !== null ? (
          <span role="alert" className="ui-error">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

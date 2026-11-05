import { ArrowLeft, ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentEntry } from "../../bindings";
import { realAgents } from "../../lib/chat/agentLineup";
import type { AppStore } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { AgentRow } from "./AgentRow";
import "./agents.css";
import "./setup.css";

/**
 * Setup's roster: what this computer has first; the agents it lacks fold into one row until
 * asked. Rows resolve in place as detection finishes.
 */
export function AgentRoster({
  agents,
  transport,
  onRefresh,
}: {
  readonly agents: readonly AgentEntry[];
  readonly transport: Transport;
  readonly onRefresh: () => void;
}) {
  const [everyAgent, setEveryAgent] = useState(false);
  const absent = (agent: AgentEntry) =>
    agent.availability.state === "missing" || agent.availability.state === "broken";
  const folded = agents.some((agent) => agent.availability.state === "ready")
    ? agents.filter(absent)
    : [];
  // Unfolded, the absent agents follow the ones this computer has, so a found agent never moves
  // down among them.
  const present = agents.filter((agent) => !folded.includes(agent));
  const shown = everyAgent ? [...present, ...folded] : present;
  return (
    <ul className="agent-list" data-compact="">
      {shown.map((agent, index) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          transport={transport}
          onRefresh={onRefresh}
          compact
          index={index}
        />
      ))}
      {folded.length > 0 ? (
        <li className="agent-list-more">
          <button
            type="button"
            aria-expanded={everyAgent}
            onClick={() => setEveryAgent(!everyAgent)}
          >
            {everyAgent ? "Hide the agents not installed" : `Show ${folded.length} not installed`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** Agents (Vercel's project list): one row per harness, one action each, a menu for the rest. */
export function AgentsScreen({
  app,
  transport,
  onBack,
  onSetup,
  embedded = false,
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly onBack: () => void;
  readonly onSetup: () => void;
  /**
   * Settings > Agents: no bar or title of its own, and the store keeps running for the chats
   * mounted behind Settings, so this page neither starts nor stops it.
   */
  readonly embedded?: boolean;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  useEffect(() => {
    if (embedded) return;
    app.start();
    return () => app.stop();
  }, [app, embedded]);
  const agents = state.agents;
  // The counts are about this computer, as setup's are: the built-in demo is not installed here.
  const counted = agents === null ? null : realAgents(agents);
  const installed = counted?.filter((agent) => agent.availability.state === "ready").length ?? 0;
  const looking = counted?.filter((agent) => agent.availability.state === "checking").length ?? 0;
  const refresh = () => void app.refreshAgents();
  const summary = (
    <p aria-live="polite">
      {agents === null
        ? "Looking for the agents on this computer."
        : looking > 0
          ? `${installed} found so far. Still looking for ${looking}.`
          : `${installed} of ${counted?.length ?? 0} installed on this computer.`}
    </p>
  );
  const refreshButton = (
    <button
      type="button"
      className="g-button g-button-outline"
      disabled={state.agentsRefreshing}
      onClick={refresh}
    >
      {state.agentsRefreshing ? (
        <span className="agents-refreshing" aria-hidden="true">
          <span className="ui-pulse" />
        </span>
      ) : (
        <RefreshCw size={14} aria-hidden="true" />
      )}
      {state.agentsRefreshing ? "Refreshing…" : "Refresh"}
    </button>
  );
  const list =
    agents === null ? (
      <div className="agent-list-empty" role="status">
        <span className="ui-pulse" aria-hidden="true" />
        <p>Looking for agents…</p>
      </div>
    ) : (
      <ul className="agent-list">
        {agents.map((agent, index) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            transport={transport}
            onRefresh={refresh}
            onConnection={(agentId, connection) => app.setAgentConnection(agentId, connection)}
            index={index}
          />
        ))}
      </ul>
    );
  if (embedded)
    return (
      <div className="agents-page" data-embedded="" data-setting="Agents">
        <div className="agents-head">
          {summary}
          {refreshButton}
        </div>
        {list}
      </div>
    );
  return (
    <main className="setup-shell g-root agents-screen">
      <div className="setup-drag" data-tauri-drag-region="" />
      <div className="agents-page">
        <header className="agents-bar">
          <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to chats
          </button>
          <button type="button" className="g-button g-button-ghost g-button-28" onClick={onSetup}>
            Run setup again
          </button>
        </header>
        <div className="agents-head">
          <div>
            <h1>Agents</h1>
            {summary}
          </div>
          {refreshButton}
        </div>
        {list}
      </div>
    </main>
  );
}

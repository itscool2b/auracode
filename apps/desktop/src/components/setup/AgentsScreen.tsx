import { PixelLoader } from "@auracode/ui/graphite";
import { ArrowLeft, ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentEntry } from "../../bindings";
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
  const shown = everyAgent ? agents : agents.filter((agent) => !folded.includes(agent));
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
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly onBack: () => void;
  readonly onSetup: () => void;
}) {
  const state = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);
  const agents = state.agents;
  const installed = agents?.filter((agent) => agent.availability.state === "ready").length ?? 0;
  const looking = agents?.filter((agent) => agent.availability.state === "checking").length ?? 0;
  const refresh = () => void app.refreshAgents();
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
            <p aria-live="polite">
              {agents === null
                ? "Looking for the agents on this computer."
                : looking > 0
                  ? `${installed} found so far. Still looking for ${looking}.`
                  : `${installed} of ${agents.length} installed on this computer.`}
            </p>
          </div>
          <button
            type="button"
            className="g-button g-button-outline"
            disabled={state.agentsRefreshing}
            onClick={refresh}
          >
            {state.agentsRefreshing ? (
              <PixelLoader size={14} tempo="tool" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            {state.agentsRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {agents === null ? (
          <div className="agent-list-empty" role="status">
            <PixelLoader size={16} tempo="thinking" />
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
        )}
      </div>
    </main>
  );
}

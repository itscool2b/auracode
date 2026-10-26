import { OrbitMark, useOrbitTheme } from "@auracode/ui/orbit";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentEntry } from "../../bindings";
import { type AppStore, agentChoice } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { AgentActions } from "../chat/AgentActions";
import { AgentInstallations } from "./AgentInstallations";
import { InstallAgent } from "./InstallAgent";
import "./setup.css";

// External help links are presentation content. Rust still owns every install/update command.
// Sources checked 2026-10-26; no shell instructions are synthesized from executable names.
const INSTALL_GUIDES: Readonly<Record<string, string>> = {
  claude: "https://code.claude.com/docs/en/setup",
  "claude-acp": "https://code.claude.com/docs/en/setup",
  codex: "https://developers.openai.com/codex/cli",
  "codex-acp": "https://developers.openai.com/codex/cli",
  pi: "https://pi.dev/docs/latest/quickstart",
  cursor: "https://cursor.com/docs/cli/installation",
  grok: "https://docs.x.ai/build/overview",
  "grok-stream": "https://docs.x.ai/build/overview",
  omp: "https://github.com/can1357/oh-my-pi",
  opencode: "https://opencode.ai/docs",
  "opencode-v2": "https://opencode.ai/docs",
  antigravity: "https://antigravity.google/download",
  "agy-stream": "https://antigravity.google/download",
  hermes: "https://hermes-agent.nousresearch.com/docs/getting-started/installation",
};

export function AgentRoster({
  agents,
  transport,
  onRefresh,
  compact = false,
}: {
  readonly agents: readonly AgentEntry[];
  readonly transport: Transport;
  readonly onRefresh: () => void;
  readonly compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="setup-roster">
      {agents.map((agent) => {
        const choice = agentChoice(agent);
        const ready = agent.availability.state === "ready";
        return (
          <li key={agent.id}>
            <button
              type="button"
              className="setup-agent-row"
              aria-expanded={expanded === agent.id}
              onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}
            >
              <OrbitMark agent={agent.id} size={24} ghost={!choice.enabled} />
              <span>
                <strong>{agent.name}</strong>
                <small>
                  {agent.availability.state === "ready"
                    ? (agent.availability.version ?? "Built in")
                    : agent.availability.state === "checking"
                      ? "Checking installation…"
                      : "Not available"}
                </small>
              </span>
              <span className="setup-agent-status">
                {ready
                  ? "Installed"
                  : agent.availability.state === "checking"
                    ? "Looking"
                    : "Set up"}
              </span>
            </button>
            {expanded === agent.id ? (
              <div className="setup-agent-detail">
                <p>{agent.description}</p>
                {choice.reason ? <p>{choice.reason}</p> : null}
                {agent.installation ? (
                  <p className="setup-path">{agent.installation.launch_path}</p>
                ) : null}
                {agent.latest_release ? (
                  <p>
                    Latest release: {agent.latest_release.version}
                    {agent.latest_release.stale ? " (cached)" : ""}
                  </p>
                ) : null}
                {ready ? (
                  <AgentActions
                    key={`${agent.id}:${agent.installation?.launch_path}:${agent.installation?.version}`}
                    agent={agent}
                    transport={transport}
                    onRefresh={onRefresh}
                  />
                ) : (
                  <div>
                    <p>
                      Install the vendor's CLI using its official instructions, then refresh
                      detection. No installation or sign-in runs automatically.
                    </p>
                    {agent.availability.state === "missing" &&
                    ["claude", "codex", "pi"].includes(agent.id) ? (
                      <InstallAgent
                        agentId={agent.id}
                        agentName={agent.name}
                        onRefresh={onRefresh}
                      />
                    ) : null}
                    {INSTALL_GUIDES[agent.id] ? (
                      <a className="setup-guide" href={INSTALL_GUIDES[agent.id]} rel="noreferrer">
                        Open official installation guide <span aria-hidden="true">↗</span>
                      </a>
                    ) : null}
                  </div>
                )}
                {agent.id !== "demo" ? (
                  <AgentInstallations agentId={agent.id} onChanged={onRefresh} />
                ) : null}
                {!compact ? (
                  <p className="setup-meta">
                    Transport: {agent.id} · Last checked integration: {agent.last_verified}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

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
  const theme = useOrbitTheme();
  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);
  return (
    <main className="setup-shell orbit-theme agents-screen" data-theme={theme}>
      <header>
        <button type="button" className="setup-text-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back to chats
        </button>
        <button type="button" className="setup-text-button" onClick={onSetup}>
          Run setup again
        </button>
      </header>
      <div className="agents-content">
        <div className="agents-heading">
          <div>
            <span className="setup-eyebrow">YOUR TOOLS, TOGETHER</span>
            <h1>Agents</h1>
            <p>Installed harnesses, their versions and the access they support.</p>
          </div>
          <button
            type="button"
            className="setup-button"
            disabled={state.agentsRefreshing}
            onClick={() => void app.refreshAgents()}
          >
            <RefreshCw size={14} /> {state.agentsRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {state.agents === null ? (
          <p role="status">Looking for agents…</p>
        ) : (
          <AgentRoster
            agents={state.agents}
            transport={transport}
            onRefresh={() => void app.refreshAgents()}
          />
        )}
        <p className="setup-footnote">
          Verification applies to the listed integration version. A newer vendor release may behave
          differently. Sign-in uses the vendor's own terminal and starts only when you choose it.
        </p>
      </div>
    </main>
  );
}

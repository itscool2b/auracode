import { AgentMark, StatusDot } from "@auracode/ui/graphite";
import { ArrowLeft, ArrowUpRight, ChevronRight, RefreshCw } from "lucide-react";
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
  const [everyAgent, setEveryAgent] = useState(false);
  const absent = (agent: AgentEntry) =>
    agent.availability.state === "missing" || agent.availability.state === "broken";
  // Setup leads with what this computer has; the agents it lacks fold into one row until asked.
  const folded =
    compact && agents.some((agent) => agent.availability.state === "ready")
      ? agents.filter(absent)
      : [];
  const shown = everyAgent ? agents : agents.filter((agent) => !folded.includes(agent));
  return (
    <ul className="setup-roster" data-compact={compact || undefined}>
      {shown.map((agent) => {
        const choice = agentChoice(agent);
        const ready = agent.availability.state === "ready";
        const checking = agent.availability.state === "checking";
        const open = expanded === agent.id;
        return (
          <li key={agent.id}>
            <button
              type="button"
              className="setup-agent-row"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : agent.id)}
            >
              {/* The name and status beside the mark say what it shows. */}
              <span className="setup-agent-mark" aria-hidden="true">
                <AgentMark
                  agent={agent.id}
                  size={24}
                  state={checking ? "thinking" : "idle"}
                  ghost={!choice.enabled}
                />
              </span>
              <span className="setup-agent-text">
                <strong>{agent.name}</strong>
                {agent.availability.state === "ready" ? (
                  <small>{agent.availability.version ?? "Built in"}</small>
                ) : checking ? (
                  <small>Checking installation…</small>
                ) : null}
              </span>
              <span className="setup-agent-status" data-state={agent.availability.state}>
                {ready ? <StatusDot tone="green" /> : null}
                {ready
                  ? "Installed"
                  : checking
                    ? "Looking"
                    : agent.availability.state === "broken"
                      ? "Unavailable"
                      : "Not installed"}
              </span>
              <ChevronRight className="setup-agent-chevron" size={14} aria-hidden="true" />
            </button>
            {open ? (
              <div className="setup-agent-detail">
                <p>{agent.description}</p>
                {choice.reason ? <p>{choice.reason}</p> : null}
                {agent.installation ? (
                  <p className="setup-path">{agent.installation.launch_path}</p>
                ) : null}
                {agent.latest_release ? (
                  <p>
                    Latest release{" "}
                    <span className="setup-version">{agent.latest_release.version}</span>
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
                  <div className="setup-agent-install">
                    <p>
                      Install the vendor's CLI using its official instructions, then refresh
                      detection. No installation or sign-in runs automatically.
                    </p>
                    <div className="setup-agent-links">
                      {agent.availability.state === "missing" &&
                      ["claude", "codex", "pi", "opencode"].includes(agent.id) ? (
                        <InstallAgent
                          agentId={agent.id}
                          agentName={agent.name}
                          onRefresh={onRefresh}
                        />
                      ) : null}
                      {INSTALL_GUIDES[agent.id] ? (
                        <a className="setup-guide" href={INSTALL_GUIDES[agent.id]} rel="noreferrer">
                          Open official installation guide
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                )}
                {agent.id !== "demo" ? (
                  <AgentInstallations agentId={agent.id} onChanged={onRefresh} />
                ) : null}
                {!compact ? (
                  <p className="setup-meta">
                    Transport {agent.id} · Last checked integration {agent.last_verified}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
      {folded.length > 0 ? (
        <li>
          <button
            type="button"
            className="setup-roster-more"
            aria-expanded={everyAgent}
            onClick={() => setEveryAgent(!everyAgent)}
          >
            {everyAgent
              ? "Hide agents that are not installed"
              : `Show ${folded.length} not installed`}
            <ChevronRight className="setup-agent-chevron" size={14} aria-hidden="true" />
          </button>
        </li>
      ) : null}
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
  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);
  const installed =
    state.agents?.filter((agent) => agent.availability.state === "ready").length ?? 0;
  return (
    <main className="setup-shell g-root agents-screen">
      <div className="setup-drag" data-tauri-drag-region="" />
      <header className="agents-bar">
        <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back to chats
        </button>
        <button type="button" className="g-button g-button-ghost g-button-28" onClick={onSetup}>
          Run setup again
        </button>
      </header>
      <div className="agents-content">
        <div className="agents-heading">
          <h1>
            Agents
            <span>
              {state.agents === null
                ? "Looking for the harnesses on this computer."
                : `${installed} installed on this computer, with the versions and access they support.`}
            </span>
          </h1>
          <button
            type="button"
            className="g-button g-button-outline"
            disabled={state.agentsRefreshing}
            onClick={() => void app.refreshAgents()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {state.agentsRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {state.agents === null ? (
          <p className="setup-footnote" role="status">
            Looking for agents…
          </p>
        ) : (
          <AgentRoster
            agents={state.agents}
            transport={transport}
            onRefresh={() => void app.refreshAgents()}
          />
        )}
        <p className="setup-footnote agents-footnote">
          Verification applies to the listed integration version. A newer vendor release may behave
          differently. Sign-in uses the vendor's own terminal and starts only when you choose it.
        </p>
      </div>
    </main>
  );
}

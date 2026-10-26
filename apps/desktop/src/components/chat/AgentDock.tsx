import { OrbitMark } from "@auracode/ui/orbit";
import { Settings2 } from "lucide-react";
import type { AgentEntry, ChatSummary } from "../../bindings";
import { agentChoice } from "../../lib/chat/appStore";
import { Popover } from "./Popover";

const CODES: Readonly<Record<string, string>> = {
  claude: "CC",
  codex: "CX",
  pi: "PI",
  omp: "MP",
  goose: "GO",
  opencode: "OC",
  gemini: "GM",
  cursor: "CU",
  grok: "GB",
};

export function AgentDock({
  agents,
  chats,
  onChoose,
  onDiagnostics,
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly chats: readonly ChatSummary[] | null;
  readonly onChoose: (agentId: string) => void;
  readonly onDiagnostics: () => void;
}) {
  const ready = agents?.filter((agent) => agentChoice(agent).enabled).length ?? 0;
  return (
    <div className="chat-sidebar-footer">
      <h2 className="chat-section-label">
        Agents{" "}
        <span>
          {ready}/{agents?.length ?? 0}
        </span>
      </h2>
      <div className="chat-agent-dock">
        {(agents ?? []).map((agent) => {
          const choice = agentChoice(agent);
          const sessions = (chats ?? []).filter((chat) => chat.agent_id === agent.id);
          const state = sessions.some((chat) => chat.needs_attention)
            ? "waiting"
            : sessions.some((chat) => chat.status === "running")
              ? "tool"
              : "idle";
          return (
            <Popover
              key={agent.id}
              label={agent.name}
              className="chat-agent-popover"
              trigger={
                <>
                  <OrbitMark agent={agent.id} state={state} size={24} ghost={!choice.enabled} />
                  <span>{CODES[agent.id] ?? agent.name.slice(0, 2).toUpperCase()}</span>
                </>
              }
            >
              <strong>{agent.name}</strong>
              <p>{agent.description}</p>
              {choice.reason ? (
                <p>{choice.reason}</p>
              ) : (
                <p>
                  {agent.availability.state === "ready"
                    ? `Installed${agent.availability.version ? ` · ${agent.availability.version}` : ""}`
                    : "Checking installation…"}
                </p>
              )}
              <button
                type="button"
                className="ui-button"
                disabled={!choice.enabled}
                onClick={() => onChoose(agent.id)}
              >
                New chat with {agent.name}
              </button>
            </Popover>
          );
        })}
      </div>
      <div className="chat-account-row">
        <span className="chat-account-avatar">L</span>
        <span>
          <strong>Local</strong>
          <small>Stored on this device</small>
        </span>
        <button
          type="button"
          className="chat-icon-button"
          aria-label="Open diagnostics"
          title="Diagnostics"
          onClick={onDiagnostics}
        >
          <Settings2 size={16} />
        </button>
      </div>
    </div>
  );
}

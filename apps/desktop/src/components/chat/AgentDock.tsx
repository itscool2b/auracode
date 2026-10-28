import { AgentMark } from "@auracode/ui/graphite";
import type { AgentEntry, ChatSummary, ProfileMeta } from "../../bindings";
import { agentChoice } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { AgentActions } from "./AgentActions";
import { Popover } from "./Popover";
import { ProfileStatus } from "./ProfileStatus";

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
  onAgents,
  onSettings,
  transport,
  onRefresh,
  profile = null,
}: {
  readonly agents: readonly AgentEntry[] | null;
  readonly chats: readonly ChatSummary[] | null;
  readonly onChoose: (agentId: string) => void;
  readonly onDiagnostics: () => void;
  readonly onAgents?: () => void;
  readonly onSettings?: () => void;
  readonly transport?: Transport;
  readonly onRefresh?: () => void;
  readonly profile?: ProfileMeta | null;
}) {
  const ready = agents?.filter((agent) => agentChoice(agent).enabled).length ?? 0;
  return (
    <div className="chat-sidebar-footer">
      <h2 className="chat-section-label">
        {onAgents ? (
          <button type="button" onClick={onAgents} className="chat-dock-link">
            Agents
          </button>
        ) : (
          "Agents"
        )}{" "}
        <span>
          {ready}/{agents?.length ?? 0}
        </span>
      </h2>
      <div className="chat-agent-dock">
        {(agents ?? []).map((agent) => {
          const code = CODES[agent.id] ?? agent.name.slice(0, 2).toUpperCase();
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
              triggerLabel={`${code} ${agent.name}`}
              className="chat-agent-popover"
              trigger={
                <>
                  <AgentMark agent={agent.id} state={state} size={24} ghost={!choice.enabled} />
                  <span>{code}</span>
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
                className="g-button"
                disabled={!choice.enabled}
                onClick={() => onChoose(agent.id)}
              >
                New chat with {agent.name}
              </button>
              {transport && onRefresh ? (
                <AgentActions agent={agent} transport={transport} onRefresh={onRefresh} />
              ) : null}
            </Popover>
          );
        })}
      </div>
      <ProfileStatus profile={profile} onSettings={onSettings} onDiagnostics={onDiagnostics} />
    </div>
  );
}

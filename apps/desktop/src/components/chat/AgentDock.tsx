import { getBrand } from "@auracode/ui";
import { AgentMark, agentCode } from "@auracode/ui/graphite";
import type { AgentEntry, ChatSummary, ProfileMeta } from "../../bindings";
import { agentChoice } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { AgentActions } from "./AgentActions";
import { closePopover, Popover } from "./Popover";
import { ProfileStatus } from "./ProfileStatus";

/** What one dock tile shows: detection, readiness, sign-in, work, or a wait on you. */
export type DockState = "checking" | "ready" | "sign-in" | "running" | "waiting";

const DEMO = "mock";

/** One product per tile: native and adapter variants (Claude Code and its ACP twin) share a brand. */
function productOf(agent: AgentEntry): string {
  const brand = getBrand(agent.id).id;
  return brand === "generic" ? agent.id : brand;
}

/**
 * The agents the dock shows: one per product, the first usable variant in catalog order (the
 * catalog lists native before compatibility adapters), so Claude Code appears once and Codex once.
 * Missing, broken and alternate variants, and the scripted demo while a real agent is usable, wait
 * behind "+N".
 */
export function dockAgents(agents: readonly AgentEntry[]): {
  shown: AgentEntry[];
  rest: AgentEntry[];
} {
  const products = new Map<string, AgentEntry[]>();
  for (const agent of agents) {
    const key = productOf(agent);
    products.set(key, [...(products.get(key) ?? []), agent]);
  }
  const shown: AgentEntry[] = [];
  for (const variants of products.values()) {
    const pick =
      variants.find((agent) => agent.availability.state === "ready") ??
      variants.find((agent) => agent.availability.state === "checking");
    if (pick) shown.push(pick);
  }
  const real = shown.filter((agent) => agent.id !== DEMO);
  const visible = real.length > 0 ? real : shown;
  return { shown: visible, rest: agents.filter((agent) => !visible.includes(agent)) };
}

export function dockState(agent: AgentEntry, chats: readonly ChatSummary[]): DockState {
  const sessions = chats.filter((chat) => chat.agent_id === agent.id);
  if (sessions.some((chat) => chat.needs_attention)) return "waiting";
  if (sessions.some((chat) => chat.status === "running" || chat.status === "starting"))
    return "running";
  if (sessions.some((chat) => chat.status === "auth_required")) return "sign-in";
  return agent.availability.state === "checking" ? "checking" : "ready";
}

const STATE_WORDS: Readonly<Record<DockState, string>> = {
  checking: "Looking for it",
  ready: "Ready",
  "sign-in": "Sign in needed",
  running: "Working",
  waiting: "Needs you",
};

function updateOf(agent: AgentEntry): string | null {
  const latest = agent.latest_release?.version ?? null;
  const installed = agent.installation?.version ?? null;
  return latest && installed && latest !== installed ? latest : null;
}

function versionOf(agent: AgentEntry): string | null {
  return agent.availability.state === "ready"
    ? (agent.installation?.version ?? agent.availability.version)
    : null;
}

/**
 * The agents you can use, one tile each, above the account row. Each tile's look is its state: a
 * calm scan while detection runs, a one-time settle once found, a quiet corner square when it
 * needs a sign-in or has an update, the walking loader while it works and the volt square while it
 * waits on you. "+N" holds everything else, with the way to the Agents screen.
 */
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
  const { shown, rest } = dockAgents(agents ?? []);
  return (
    <div className="chat-sidebar-footer">
      {agents !== null ? (
        <section className="chat-agent-dock" aria-label="Agents">
          {shown.map((agent) => {
            const state = dockState(agent, chats ?? []);
            const update = updateOf(agent);
            const version = versionOf(agent);
            const word = STATE_WORDS[state];
            return (
              <Popover
                key={agent.id}
                label={agent.name}
                // The tile's code is visible text, so the name starts with it (CC Claude Code).
                triggerLabel={`${agentCode(agent.id)} ${agent.name}, ${word.toLowerCase()}`}
                tip={[agent.name, word, update ? `Update to ${update}` : version]
                  .filter(Boolean)
                  .join(" · ")}
                className="chat-agent-popover"
                trigger={
                  <span
                    key={state}
                    className="chat-agent-tile"
                    data-state={state}
                    data-update={update ? "" : undefined}
                  >
                    <AgentMark
                      agent={agent.id}
                      state={
                        state === "waiting" ? "waiting" : state === "running" ? "tool" : "idle"
                      }
                      size={28}
                      label={`${agent.name}, ${word.toLowerCase()}`}
                    />
                  </span>
                }
              >
                <div className="chat-agent-card-head">
                  <AgentMark agent={agent.id} size={32} />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>
                      {[version, word].filter(Boolean).join(" · ")}
                      {update ? ` · ${update} available` : ""}
                    </small>
                  </span>
                </div>
                {agent.description ? <p>{agent.description}</p> : null}
                <div className="chat-agent-card-actions">
                  <button
                    type="button"
                    className="g-button g-button-28"
                    disabled={!agentChoice(agent).enabled}
                    onClick={(event) => {
                      closePopover(event.currentTarget);
                      onChoose(agent.id);
                    }}
                  >
                    New chat with {agent.name}
                  </button>
                  {onAgents ? (
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      onClick={onAgents}
                    >
                      Agent settings
                    </button>
                  ) : null}
                </div>
                {transport && onRefresh ? (
                  <AgentActions
                    agent={agent}
                    transport={transport}
                    onRefresh={onRefresh}
                    buttonClassName="g-button g-button-ghost g-button-28"
                  />
                ) : null}
              </Popover>
            );
          })}
          {rest.length > 0 ? (
            <Popover
              label="Other agents"
              triggerLabel={`${rest.length} other ${rest.length === 1 ? "agent" : "agents"}`}
              tip="Other agents"
              className="chat-agent-popover chat-agent-rest"
              trigger={<span className="chat-agent-more">+{rest.length}</span>}
            >
              <ul className="chat-agent-list">
                {rest.map((agent) => {
                  const usable = agentChoice(agent).enabled;
                  const detail = usable
                    ? (versionOf(agent) ?? "Ready")
                    : agent.availability.state === "missing"
                      ? "Not installed"
                      : agent.availability.state === "broken"
                        ? "Needs attention"
                        : "Looking for it";
                  return (
                    <li key={agent.id}>
                      <button
                        type="button"
                        className="g-menu-item"
                        data-usable={usable}
                        disabled={!usable && !onAgents}
                        title={agentChoice(agent).reason ?? undefined}
                        onClick={(event) => {
                          closePopover(event.currentTarget);
                          // A usable variant starts a chat; one to install opens the Agents screen.
                          if (usable) onChoose(agent.id);
                          else onAgents?.();
                        }}
                      >
                        <AgentMark agent={agent.id} size={16} ghost={!usable} />
                        <span className="chat-agent-list-name">{agent.name}</span>
                        <small>{detail}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {onAgents ? (
                <button
                  type="button"
                  className="g-menu-item chat-agent-manage"
                  onClick={(event) => {
                    closePopover(event.currentTarget);
                    onAgents();
                  }}
                >
                  Manage agents
                </button>
              ) : null}
            </Popover>
          ) : null}
        </section>
      ) : null}
      <ProfileStatus
        profile={profile}
        onSettings={onSettings}
        onAgents={onAgents}
        onDiagnostics={onDiagnostics}
      />
    </div>
  );
}

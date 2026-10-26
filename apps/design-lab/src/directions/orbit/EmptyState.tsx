import type { ReactNode } from "react";
import type { ChatSummary, Workspace } from "../../kit";
import { OrbitMark } from "./OrbitMark";
import { DiffCounts, DotLoader, Pip } from "./ui";

/*
 * The empty state (visual-language.md 4.13): one sentence, the input, and what just happened.
 * Grok's "empty means empty", Aside's new tab: the agent's mark at 56px, X Money's confirm-title
 * sentence ("Claude Code is ready in auracode." with the variables bright), the composer, and a
 * ledger of recent work with real outcomes. No illustration, no glow, no grid of suggestions.
 *
 * Choosing another agent in the pill flips the name up word by word (money.x.com), runs the glint
 * once along the grey rule under it (x.ai's rotating word, recoloured: an ink rule with one orange
 * band) and draws the new agent's orbit in. Under reduced motion it is a 150ms fade.
 */

function Outcome({ chat }: { readonly chat: ChatSummary }) {
  switch (chat.status) {
    case "running":
      return (
        <span className="o-ledger-outcome">
          <DotLoader />
          <span className="o-t-meta o-c2">Working for {chat.updated}</span>
        </span>
      );
    case "needs_approval":
      return <span className="o-ledger-outcome o-t-meta o-signal-text o-w-strong">Needs you</span>;
    case "error":
      return <span className="o-ledger-outcome o-t-meta o-del">Failed</span>;
    default:
      return chat.changes ? (
        <span className="o-ledger-outcome">
          <DiffCounts added={chat.changes.added} removed={chat.changes.removed} size={11} />
        </span>
      ) : (
        <span className="o-ledger-outcome o-t-meta o-c3">No changes</span>
      );
  }
}

/** The agent's name, flipped up word by word when it changes, over a grey rule the glint runs. */
function AgentName({ id, name }: { readonly id: string; readonly name: string }) {
  return (
    <span className="o-empty-agent">
      {/* Keyed on the agent, so a new agent's name enters fresh and the glint runs once more. */}
      <span key={id} className="o-empty-agent-name">
        {name.split(" ").map((word, index, words) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: words are positional.
            key={index}
            className="o-flip o-c1"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
        <span className="o-glint" aria-hidden="true" />
      </span>
    </span>
  );
}

export function EmptyState({
  workspace,
  agent,
  agentName,
  projectName,
  switched,
  onOpenChat,
  children,
}: {
  readonly workspace: Workspace;
  readonly agent: string;
  readonly agentName: string;
  readonly projectName: string;
  /** The agent was chosen here, so its arrival is shown (flip, glint, orbit), not just painted. */
  readonly switched: boolean;
  readonly onOpenChat: (chat: ChatSummary) => void;
  /** The composer, at full width. */
  readonly children: ReactNode;
}) {
  const project = workspace.projects.find(
    (candidate) => candidate.id === workspace.activeProjectId,
  );
  // What just happened in this project; the chat you are in is never in its own ledger.
  const recent = (project?.chats ?? [])
    .filter((chat) => chat.id !== workspace.activeChatId)
    .slice(0, 3);
  const nameOf = (id: string): string =>
    workspace.agents.find((candidate) => candidate.id === id)?.name ?? id;
  return (
    <div className="o-empty" data-switched={switched ? "" : undefined}>
      <div className="o-empty-hero">
        <OrbitMark
          key={agent}
          agent={agent}
          size={56}
          label={`${agentName}, ready`}
          draw={switched}
        />
        <h2 className="o-empty-sentence o-t-display">
          <AgentName id={agent} name={agentName} />
          <span className="o-c3"> is ready in </span>
          <span className="o-c1">{projectName}.</span>
        </h2>
      </div>
      <div className="o-empty-composer">{children}</div>
      {recent.length > 0 ? (
        <div className="o-ledger">
          <p className="o-t-caps o-c3 o-ledger-label">Recent in {projectName}</p>
          {recent.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className="o-ledger-row"
              onClick={() => onOpenChat(chat)}
            >
              <span className="o-ledger-pip">
                <Pip
                  kind={
                    chat.status === "running"
                      ? "running"
                      : chat.status === "needs_approval"
                        ? "needs"
                        : chat.status === "done_unseen"
                          ? "done"
                          : chat.status === "error"
                            ? "error"
                            : "idle"
                  }
                />
              </span>
              <span className="o-ledger-title o-t-ui o-c1">{chat.title}</span>
              <span className="o-t-ui o-c3 o-ledger-agent">{nameOf(chat.agent)}</span>
              <Outcome chat={chat} />
              <span className="o-t-mono o-mono-11 o-c3 o-ledger-age">
                {chat.status === "running" ? "now" : chat.updated}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

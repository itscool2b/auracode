import type { ChatSummary } from "../../bindings";
import { folderStateLabel, statusWord } from "../../lib/chat/present";

/** Chats grouped into projects by folder, each project led by its newest chat. */
export function projectsOf(
  chats: readonly ChatSummary[],
): { folder: string; chats: ChatSummary[] }[] {
  const projects = new Map<string, ChatSummary[]>();
  for (const chat of chats) {
    const list = projects.get(chat.folder) ?? [];
    list.push(chat);
    projects.set(chat.folder, list);
  }
  return [...projects].map(([folder, list]) => ({ folder, chats: list }));
}

/** A folder's last name, as its project is called. */
export function projectName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? folder;
}

/**
 * The sidebar's chat list: New chat, then each project (a folder) with its chats, newest activity
 * first: the title (or "New chat"), the agent, the status, the folder's state, and a dot when a
 * card or question waits for the user.
 */
export function ChatList({
  chats,
  error,
  selected,
  onSelect,
  onNewChat,
}: {
  readonly chats: readonly ChatSummary[] | null;
  readonly error: string | null;
  /** The open chat, or `null` while New chat shows. */
  readonly selected: string | null;
  readonly onSelect: (chatId: string) => void;
  readonly onNewChat: () => void;
}) {
  return (
    <nav aria-label="Chats" className="chat-segment" data-testid="chat-list">
      <button
        type="button"
        className="ui-button chat-new"
        data-kind="primary"
        data-testid="new-chat-button"
        onClick={onNewChat}
      >
        New chat
      </button>
      {error !== null ? (
        <p role="alert" className="ui-error" data-testid="chats-error">
          {error}
        </p>
      ) : null}
      {chats !== null && chats.length === 0 ? <p className="ui-muted">No chats yet.</p> : null}
      <ul className="chat-projects">
        {projectsOf(chats ?? []).map((project) => (
          <li key={project.folder}>
            <h2 className="chat-project-name" title={project.folder}>
              {projectName(project.folder)}
            </h2>
            <ul className="chat-chats">
              {project.chats.map((chat) => (
                <li key={chat.id}>
                  <ChatRow chat={chat} selected={chat.id === selected} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ChatRow({
  chat,
  selected,
  onSelect,
}: {
  readonly chat: ChatSummary;
  readonly selected: boolean;
  readonly onSelect: (chatId: string) => void;
}) {
  const folder = folderStateLabel(chat.folder_state);
  return (
    <button
      type="button"
      className="chat-row"
      aria-current={selected}
      title={chat.folder}
      data-testid="chat-row"
      data-test-chat-id={chat.id}
      data-test-status={chat.status}
      data-test-attention={String(chat.needs_attention)}
      data-test-folder-state={chat.folder_state}
      onClick={() => onSelect(chat.id)}
    >
      <span className="chat-row-title">
        <span data-testid="chat-row-title">{chat.title ?? "New chat"}</span>
        {chat.needs_attention ? (
          <span className="chat-dot" role="img" aria-label="Waiting for your answer" />
        ) : null}
      </span>
      <span className="chat-row-meta">
        {chat.agent_name} · {statusWord(chat.status)}
      </span>
      {folder !== null ? <span className="chat-row-warning">{folder}</span> : null}
    </button>
  );
}

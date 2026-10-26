import { ChevronRight, Search, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatSummary } from "../../bindings";
import { folderStateLabel, statusWord } from "../../lib/chat/present";

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

export function projectName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? folder;
}

/** The project tray shares the selected Orbit frame, with live attention and folder state. */
export function ChatList({
  chats,
  error,
  selected,
  onSelect,
  onNewChat,
}: {
  readonly chats: readonly ChatSummary[] | null;
  readonly error: string | null;
  readonly selected: string | null;
  readonly onSelect: (chatId: string) => void;
  readonly onNewChat: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const all = chats ?? [];
  const filtered = all.filter((chat) =>
    `${chat.title ?? "New chat"} ${chat.folder} ${chat.agent_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const projects = projectsOf(filtered);
  const waiting = filtered.filter((chat) => chat.needs_attention);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onNewChat]);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  return (
    <nav aria-label="Chats" className="chat-navigation" data-testid="chat-list">
      <div className="chat-nav-actions">
        <button
          type="button"
          className="chat-nav-action"
          data-testid="new-chat-button"
          onClick={onNewChat}
        >
          <SquarePen size={16} />
          <span>New chat</span>
          <kbd>N</kbd>
        </button>
        <button
          type="button"
          className="chat-nav-action"
          onClick={() => setSearching((value) => !value)}
          aria-expanded={searching}
        >
          <Search size={16} />
          <span>Search</span>
          <kbd>K</kbd>
        </button>
        {searching ? (
          <input
            ref={search}
            className="ui-input chat-sidebar-search"
            aria-label="Search chats"
            placeholder="Find a chat…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setSearching(false);
                setQuery("");
              }
            }}
          />
        ) : null}
      </div>
      {error !== null ? (
        <p role="alert" className="ui-error" data-testid="chats-error">
          {error}
        </p>
      ) : null}
      <div className="chat-project-scroll">
        {waiting.length > 0 ? (
          <section className="chat-attention" aria-label="Needs you">
            <h2 className="chat-section-label">
              Needs you <span>{waiting.length}</span>
            </h2>
            {waiting.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className="chat-attention-row"
                onClick={() => onSelect(chat.id)}
              >
                <span className="chat-dot" />
                <span>
                  {chat.title ?? "New chat"}
                  <small> · {projectName(chat.folder)}</small>
                </span>
              </button>
            ))}
          </section>
        ) : null}
        <h2 className="chat-section-label">
          Projects <span>{projects.length}</span>
        </h2>
        {chats !== null && all.length === 0 ? (
          <p className="chat-sidebar-empty">Your projects and chats will appear here.</p>
        ) : null}
        {query && filtered.length === 0 ? (
          <p className="chat-sidebar-empty">No chats match “{query}”.</p>
        ) : null}
        <ul className="chat-projects">
          {projects.map((project, index) => (
            <li key={project.folder}>
              <button
                type="button"
                className="chat-project-toggle"
                title={project.folder}
                aria-expanded={!folded.has(project.folder)}
                onClick={() =>
                  setFolded((current) => {
                    const next = new Set(current);
                    if (next.has(project.folder)) next.delete(project.folder);
                    else next.add(project.folder);
                    return next;
                  })
                }
              >
                <span className="chat-project-swatch" data-tone={index % 4}>
                  <ChevronRight size={12} />
                </span>
                <span>{projectName(project.folder)}</span>
                <small>{project.chats.length}</small>
              </button>
              {!folded.has(project.folder) ? (
                <ul className="chat-chats">
                  {project.chats.map((chat) => (
                    <li key={chat.id}>
                      <ChatRow chat={chat} selected={chat.id === selected} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
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
  const label = chat.needs_attention
    ? "Waiting for your answer"
    : (folder ?? statusWord(chat.status));
  const running = chat.status === "running" || chat.status === "starting";
  return (
    <button
      type="button"
      className="chat-row"
      aria-current={selected}
      title={`${chat.agent_name} · ${label}\n${chat.folder}`}
      data-testid="chat-row"
      data-test-chat-id={chat.id}
      data-test-status={chat.status}
      data-test-attention={String(chat.needs_attention)}
      data-test-folder-state={chat.folder_state}
      onClick={() => onSelect(chat.id)}
    >
      <span className="chat-row-title" data-testid="chat-row-title">
        {chat.title ?? "New chat"}
      </span>
      {chat.needs_attention ? (
        <span className="chat-dot" role="img" aria-label={label} />
      ) : chat.status === "failed" || folder !== null ? (
        <span className="chat-row-warning" role="img" aria-label={label}>
          !
        </span>
      ) : running ? (
        <span className="chat-running-dot" role="img" aria-label={label} />
      ) : null}
    </button>
  );
}

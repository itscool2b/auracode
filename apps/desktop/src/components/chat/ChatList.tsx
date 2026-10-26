import { Archive, ChevronRight, Ellipsis, Pin, Plus, Search, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatSummary, ProjectSummary, WorkspaceSnapshot } from "../../bindings";
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
  active = true,
  chats,
  error,
  selected,
  onSelect,
  onNewChat,
  organization,
  onNewProject,
  onProjectSettings,
  onChatOptions,
  archived = false,
  onShowArchived,
  onSearch,
}: {
  readonly active?: boolean;
  readonly chats: readonly ChatSummary[] | null;
  readonly error: string | null;
  readonly selected: string | null;
  readonly onSelect: (chatId: string) => void;
  readonly onNewChat: () => void;
  readonly organization?: WorkspaceSnapshot | null;
  readonly onNewProject?: () => void;
  readonly onProjectSettings?: (project: ProjectSummary) => void;
  readonly onChatOptions?: (chat: ChatSummary) => void;
  readonly archived?: boolean;
  readonly onShowArchived?: () => void;
  readonly onSearch?: () => void;
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
  const membership = new Map(organization?.chats.map((entry) => [entry.chat.id, entry]));
  const projects = organization
    ? organization.projects
        .map((project) => ({
          folder: project.id,
          name: project.name,
          color: project.color,
          project,
          chats: filtered
            .filter((chat) => membership.get(chat.id)?.project_id === project.id)
            .sort(
              (a, b) => Number(membership.get(b.id)?.pinned) - Number(membership.get(a.id)?.pinned),
            ),
        }))
        .filter(
          (project) =>
            !query ||
            project.chats.length > 0 ||
            project.name.toLowerCase().includes(query.toLowerCase()),
        )
    : projectsOf(filtered).map((project) => ({
        ...project,
        name: projectName(project.folder),
        color: null,
        project: null,
      }));
  const waiting = filtered.filter((chat) => chat.needs_attention);
  useEffect(() => {
    if (!active) return;
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (onSearch) onSearch();
        else setSearching(true);
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onNewChat, onSearch, active]);
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
          onClick={() => (onSearch ? onSearch() : setSearching((value) => !value))}
          aria-expanded={onSearch ? undefined : searching}
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
          {archived ? "Archived" : "Projects"} <span>{projects.length}</span>
          {onNewProject ? (
            <button
              type="button"
              className="chat-icon-button"
              title="New project"
              aria-label="New project"
              onClick={onNewProject}
            >
              <Plus size={13} />
            </button>
          ) : null}
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
              <div className="chat-project-heading">
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
                  <span
                    className="chat-project-swatch"
                    data-tone={index % 4}
                    style={project.color ? { backgroundColor: project.color } : undefined}
                  >
                    <ChevronRight size={12} />
                  </span>
                  <span>{project.name}</span>
                  <small>{project.chats.length}</small>
                </button>
                {onProjectSettings && project.project ? (
                  <button
                    type="button"
                    className="chat-row-menu chat-icon-button"
                    aria-label={`Settings for ${project.name}`}
                    onClick={() => {
                      if (project.project) onProjectSettings(project.project);
                    }}
                  >
                    <Ellipsis size={14} />
                  </button>
                ) : null}
              </div>
              {!folded.has(project.folder) ? (
                <ul className="chat-chats">
                  {project.chats.map((chat) => (
                    <li key={chat.id} className="chat-row-container">
                      <ChatRow chat={chat} selected={chat.id === selected} onSelect={onSelect} />
                      {membership.get(chat.id)?.pinned ? (
                        <Pin className="chat-pin-mark" size={10} aria-label="Pinned" />
                      ) : null}
                      {onChatOptions ? (
                        <button
                          type="button"
                          className="chat-row-menu chat-icon-button"
                          aria-label={`Options for ${chat.title ?? "New chat"}`}
                          onClick={() => onChatOptions(chat)}
                        >
                          <Ellipsis size={14} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {onShowArchived ? (
        <button type="button" className="chat-nav-action" onClick={onShowArchived}>
          <Archive size={15} />
          <span>{archived ? "Back to projects" : "Archived chats"}</span>
        </button>
      ) : null}
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

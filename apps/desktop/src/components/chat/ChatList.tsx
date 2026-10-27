import { PixelLoader, StatusDot } from "@auracode/ui/graphite";
import { ChevronDown, ChevronRight, Ellipsis, Pin, Plus, Search, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatSummary, ProjectSummary, WorkspaceSnapshot } from "../../bindings";
import { folderStateLabel, statusWord } from "../../lib/chat/present";
import { commandKey, Keys } from "./Keys";

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

/**
 * The chats the sidebar's list shows, top to bottom: each open project's chats, in the order they
 * are drawn. Folded projects and a folded section show none. The "Needs you" rows repeat chats
 * that are also in this list, so they are not counted twice.
 */
export function visibleChatIds(
  projects: readonly { readonly folder: string; readonly chats: readonly ChatSummary[] }[],
  folded: ReadonlySet<string>,
  sectionFolded: boolean,
): string[] {
  if (sectionFolded) return [];
  return projects.flatMap((project) =>
    folded.has(project.folder) ? [] : project.chats.map((chat) => chat.id),
  );
}

/**
 * Which chat Ctrl+1 to Ctrl+9 (Cmd on macOS) opens: 0 for the first. The physical digit key
 * counts too, for layouts whose digits need Shift. `null` for any other key or while composing.
 */
export function chatShortcutIndex(event: {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}): number | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? /^[1-9]$/.exec(event.key)?.[0];
  return digit === undefined ? null : Number(digit) - 1;
}

export function projectName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? folder;
}

/**
 * The sidebar's navigation (Grok's order): Search and New chat, the chats waiting on you, then the
 * projects with their chats, and a quiet "Archived chats" row at the end, like Grok's "See all".
 */
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
  const [sectionFolded, setSectionFolded] = useState(false);
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
  const visible = visibleChatIds(projects, folded, sectionFolded);
  const shortcuts = useRef(visible);
  shortcuts.current = visible;
  useEffect(() => {
    if (!active) return;
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const index = chatShortcutIndex(event);
      if (index !== null) {
        // Like Ctrl+J, a chat never opens behind an open dialog.
        if (document.querySelector("dialog[open]")) return;
        const chatId = shortcuts.current[index];
        if (chatId === undefined) return;
        event.preventDefault();
        onSelect(chatId);
      } else if (event.key.toLowerCase() === "k") {
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
  }, [onNewChat, onSearch, onSelect, active]);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  const section = archived ? "Archived" : "Projects";
  return (
    <nav aria-label="Chats" className="chat-navigation" data-testid="chat-list">
      <div className="chat-nav-actions">
        <button
          type="button"
          className="chat-nav-action"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => (onSearch ? onSearch() : setSearching((value) => !value))}
          aria-expanded={onSearch ? undefined : searching}
        >
          <Search size={16} />
          <span>Search</span>
          <Keys keys={[commandKey(), "K"]} />
        </button>
        <button
          type="button"
          className="chat-nav-action"
          data-testid="new-chat-button"
          aria-keyshortcuts="Control+N Meta+N"
          onClick={onNewChat}
        >
          <SquarePen size={16} />
          <span>New chat</span>
          <Keys keys={[commandKey(), "N"]} />
        </button>
        {searching ? (
          <input
            ref={search}
            className="g-input chat-sidebar-search"
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
              <span className="chat-section-title">Needs you</span>
              <span className="chat-section-count">{waiting.length}</span>
            </h2>
            {waiting.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className="chat-attention-row"
                onClick={() => onSelect(chat.id)}
              >
                <span className="chat-attention-mark">
                  <StatusDot tone="volt" />
                </span>
                <span>
                  {chat.title ?? "New chat"}
                  <small> · {projectName(chat.folder)}</small>
                </span>
              </button>
            ))}
          </section>
        ) : null}
        <section className="chat-project-section" aria-label={section}>
          <h2 className="chat-section-label">
            <button
              type="button"
              className="chat-section-toggle"
              aria-expanded={!sectionFolded}
              onClick={() => setSectionFolded((value) => !value)}
            >
              <span className="chat-section-title">{section}</span>
              <ChevronDown className="chat-section-chevron" size={12} aria-hidden="true" />
            </button>
            {onNewProject && !archived ? (
              <button
                type="button"
                className="g-button g-button-ghost g-button-icon g-button-24 chat-section-action"
                title="New project"
                aria-label="New project"
                onClick={onNewProject}
              >
                <Plus size={14} />
              </button>
            ) : null}
          </h2>
          {sectionFolded ? null : (
            <>
              {chats !== null && all.length === 0 ? (
                <p className="chat-sidebar-empty">
                  {archived ? "No archived chats." : "Your projects and chats will appear here."}
                </p>
              ) : null}
              {query && filtered.length === 0 ? (
                <p className="chat-sidebar-empty">No chats match “{query}”.</p>
              ) : null}
              <ul className="chat-projects">
                {projects.map((project) => {
                  const open = !folded.has(project.folder);
                  return (
                    <li key={project.folder}>
                      <div className="chat-project-heading">
                        <button
                          type="button"
                          className="chat-project-toggle"
                          title={project.folder}
                          aria-expanded={open}
                          onClick={() =>
                            setFolded((current) => {
                              const next = new Set(current);
                              if (next.has(project.folder)) next.delete(project.folder);
                              else next.add(project.folder);
                              return next;
                            })
                          }
                        >
                          {/* A neutral square: project colours never reach the chrome. */}
                          <span className="chat-project-swatch" aria-hidden="true">
                            <ChevronRight size={12} />
                          </span>
                          <span>{project.name}</span>
                          {open ? null : <FoldedState chats={project.chats} />}
                        </button>
                        {onProjectSettings && project.project ? (
                          <button
                            type="button"
                            className="g-button g-button-ghost g-button-icon g-button-24 chat-row-menu"
                            aria-label={`Settings for ${project.name}`}
                            onClick={() => {
                              if (project.project) onProjectSettings(project.project);
                            }}
                          >
                            <Ellipsis size={14} />
                          </button>
                        ) : null}
                      </div>
                      {open ? (
                        <ul className="chat-chats">
                          {project.chats.map((chat) => (
                            <li key={chat.id} className="chat-row-container">
                              <ChatRow
                                chat={chat}
                                selected={chat.id === selected}
                                onSelect={onSelect}
                                shortcut={visible.indexOf(chat.id)}
                              />
                              {membership.get(chat.id)?.pinned ? (
                                <Pin className="chat-pin-mark" size={10} aria-label="Pinned" />
                              ) : null}
                              {onChatOptions ? (
                                <button
                                  type="button"
                                  className="g-button g-button-ghost g-button-icon g-button-24 chat-row-menu"
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
                  );
                })}
              </ul>
            </>
          )}
          {onShowArchived ? (
            <button type="button" className="chat-see-all" onClick={onShowArchived}>
              {archived ? "Back to projects" : "Archived chats"}
            </button>
          ) : null}
        </section>
      </div>
    </nav>
  );
}

/**
 * A folded project says what its chats are doing where its chevron sits: a volt square while one
 * needs you, the loader while one works, a red square when one failed. Otherwise it is quiet.
 */
function FoldedState({ chats }: { readonly chats: readonly ChatSummary[] }) {
  if (chats.some((chat) => chat.needs_attention))
    return (
      <span className="chat-project-state">
        <StatusDot tone="volt" label="A chat needs you" />
      </span>
    );
  if (chats.some((chat) => chat.status === "running" || chat.status === "starting"))
    return (
      <span className="chat-project-state">
        <PixelLoader size={12} tempo="tool" label="A chat is working" />
      </span>
    );
  if (chats.some((chat) => chat.status === "failed"))
    return (
      <span className="chat-project-state">
        <StatusDot tone="red" label="A chat failed" />
      </span>
    );
  return null;
}

function ChatRow({
  chat,
  selected,
  onSelect,
  shortcut = -1,
}: {
  readonly chat: ChatSummary;
  readonly selected: boolean;
  readonly onSelect: (chatId: string) => void;
  /** The row's place among the visible chats: the first nine open with Ctrl+1 to Ctrl+9. */
  readonly shortcut?: number;
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
      data-running={running ? "" : undefined}
      aria-keyshortcuts={
        shortcut >= 0 && shortcut < 9 ? `Control+${shortcut + 1} Meta+${shortcut + 1}` : undefined
      }
      onClick={() => onSelect(chat.id)}
    >
      <span className="chat-row-title" data-testid="chat-row-title">
        {chat.title ?? "New chat"}
      </span>
      {chat.needs_attention ? (
        <span className="chat-row-status">
          <StatusDot tone="volt" label={label} />
        </span>
      ) : chat.status === "failed" || folder !== null ? (
        <span className="chat-row-status">
          <StatusDot tone="red" label={label} />
        </span>
      ) : running ? (
        <span className="chat-row-status">
          <PixelLoader size={12} tempo="tool" label={label} />
        </span>
      ) : null}
    </button>
  );
}

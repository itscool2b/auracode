import { AgentMark } from "@auracode/ui/graphite";
import { Ellipsis, PanelRight } from "lucide-react";
import type { AgentEntry, ChatSummary } from "../../bindings";
import { chatActivity } from "../../lib/chat/activity";
import type { ChatState } from "../../lib/chat/chatStore";
import { contextLabel, costLabel, folderStateLabel, statusWord } from "../../lib/chat/present";
import { hasProcess } from "../../lib/chat/transcript";
import { agentVersion, builtInPath } from "../../lib/format";
import { inTauri } from "../../lib/ipc";
import { projectName } from "./ChatList";
import { FolderContext } from "./FolderContext";
import { commandKey, Keys } from "./Keys";
import { closePopover, Popover } from "./Popover";

/** Statuses the header says out loud; Ready and Stopped stay quiet (screen readers still hear them). */
const QUIET = new Set(["ready", "stopped"]);

/**
 * The chat's header (Grok): the title and project at the left, then the status with its live mark
 * only while it says something, and two controls at the right, the Changes panel and the chat menu. The menu holds the session facts
 * (the agent and the version that runs, the context and cost when reported) and every other action;
 * the command palette offers the same actions by name.
 */
export function Header({
  state,
  listed = null,
  project = null,
  folderLabel = null,
  agent,
  resumable,
  onStart,
  onStop,
  onShowLog,
  onChanges,
  onHistory,
  onGit,
  onTools,
  onTerminal,
  terminalOpen = false,
  onExport,
  onDebug,
  changesOpen = false,
}: {
  readonly state: ChatState;
  /**
   * The chat as the chat list has it. Its folder state is the newer one: the list reloads after
   * a start fails or gets past the folder check, while the snapshot is from the join.
   */
  readonly listed?: ChatSummary | null;
  /**
   * The project the chat belongs to. A worktree chat's folder is named after its worktree id, so
   * the folder name stands in only when the workspace does not know the project.
   */
  readonly project?: string | null;
  /** Rust's selected folder label retains the managed worktree's branch and source. */
  readonly folderLabel?: string | null;
  /** The chat's agent as detection sees it, for the version that will run. */
  readonly agent: AgentEntry | null;
  /** There is an earlier session a start would continue. */
  readonly resumable: boolean;
  readonly onStart: (fresh: boolean) => void;
  readonly onStop: () => void;
  readonly onShowLog: () => void;
  readonly onChanges?: () => void;
  readonly onHistory?: () => void;
  readonly onGit?: () => void;
  readonly onTools?: () => void;
  /** Shows or hides the docked terminal panel (Ctrl+`, Cmd+` on macOS). */
  readonly onTerminal?: () => void;
  readonly terminalOpen?: boolean;
  readonly onExport?: () => void;
  readonly onDebug?: () => void;
  readonly changesOpen?: boolean;
}) {
  const { session } = state;
  const chat = listed ?? state.chat;
  const status = session?.status ?? chat?.status ?? "stopped";
  const live = hasProcess(status);
  const name = session?.agent_name ?? chat?.agent_name ?? agent?.name ?? "Agent";
  // Detection names the binary that actually runs (the user's own CLI behind an adapter); the
  // agent's own report is the fallback.
  const ready = agent?.availability.state === "ready" ? agent.availability : null;
  const version = ready?.version ?? session?.agent_version ?? null;
  const folderState = chat ? folderStateLabel(chat.folder_state) : null;
  const projectLabel = project ?? (chat ? projectName(chat.folder) : null);
  const location =
    folderLabel && folderLabel !== projectLabel ? `${projectLabel} · ${folderLabel}` : projectLabel;
  const context = contextLabel(state.usage);
  const cost = costLabel(state.usage);
  const activity = chatActivity(state);
  const statusLabel = activity === "waiting" ? "Waiting on you" : statusWord(status);
  const quiet = activity !== "waiting" && QUIET.has(status) && !session?.detail;
  const tools = chat && inTauri() ? onTools : undefined;
  const files = chat && inTauri();
  const item = (run: () => void) => (event: { currentTarget: Element }) => {
    closePopover(event.currentTarget);
    run();
  };
  return (
    <header className="chat-header" data-testid="chat-header">
      <div className="chat-header-who">
        <span className="chat-header-title" title={chat?.title ?? "New chat"}>
          {chat?.title ?? "New chat"}
        </span>
        {chat ? (
          <span className="chat-header-folder" title={chat.folder}>
            {location}
            {folderState !== null ? <span className="chat-row-flag"> · {folderState}</span> : null}
          </span>
        ) : null}
        <span
          className="chat-status"
          data-status={status}
          data-activity={activity}
          data-quiet={quiet ? "" : undefined}
          data-testid="chat-status"
          data-test-status={status}
          aria-live="polite"
        >
          {/* The live mark rides with the status it shows, so the title never moves (Grok). */}
          {activity !== "idle" ? (
            <span className="chat-status-mark" aria-hidden="true">
              <AgentMark
                agent={chat?.agent_id ?? agent?.id ?? "generic"}
                state={activity}
                size={16}
                label={`${name}, ${session?.detail ?? statusLabel}`}
              />
            </span>
          ) : null}
          {statusLabel}
          {session?.detail ? <span className="chat-status-detail"> · {session.detail}</span> : null}
        </span>
        {state.actionError !== null ? (
          <span
            role="alert"
            className="chat-header-error"
            title={state.actionError}
            data-testid="chat-action-error"
          >
            {state.actionError}
          </span>
        ) : null}
      </div>
      <div className="chat-header-controls">
        {onChanges ? (
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon g-button-28"
            aria-label="Changes"
            title={`Changes (${commandKey()} J)`}
            aria-keyshortcuts="Control+J Meta+J"
            aria-expanded={changesOpen}
            onClick={(event) => {
              event.currentTarget.focus();
              onChanges();
            }}
          >
            <PanelRight size={16} />
          </button>
        ) : null}
        <Popover
          label="Chat details and controls"
          tip="More"
          className="chat-header-menu"
          trigger={<Ellipsis size={16} />}
        >
          <div className="chat-session-info">
            <strong>{name}</strong>
            <span>{version === null ? "Version not reported" : agentVersion(name, version)}</span>
            {ready?.path ? <span className="ui-mono">{builtInPath(ready.path)}</span> : null}
            {context !== null || cost !== null ? (
              <span className="chat-session-usage" data-testid="chat-usage">
                {[context, cost].filter((part) => part !== null).join(" · ")}
              </span>
            ) : null}
          </div>
          {onGit || onTerminal || tools || onHistory ? (
            <div className="chat-header-actions">
              {onGit ? (
                <button type="button" className="g-menu-item" onClick={item(onGit)}>
                  Git workspace
                </button>
              ) : null}
              {onTerminal ? (
                <button
                  type="button"
                  className="g-menu-item"
                  data-testid="chat-terminal-toggle"
                  aria-keyshortcuts="Control+` Meta+`"
                  onClick={item(onTerminal)}
                >
                  {terminalOpen ? "Hide terminal" : "Show terminal"}
                  <Keys keys={[commandKey(), "`"]} />
                </button>
              ) : null}
              {tools ? (
                <button type="button" className="g-menu-item" onClick={item(tools)}>
                  Open in editor
                </button>
              ) : null}
              {onHistory ? (
                <button type="button" className="g-menu-item" onClick={item(onHistory)}>
                  Conversation history
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="chat-header-actions">
            {files && onExport ? (
              <button type="button" className="g-menu-item" onClick={item(onExport)}>
                Export chat
              </button>
            ) : null}
            {files && onDebug ? (
              <button type="button" className="g-menu-item" onClick={item(onDebug)}>
                Copy debug bundle
              </button>
            ) : null}
            <button
              type="button"
              className="g-menu-item"
              data-testid="chat-show-log"
              onClick={item(onShowLog)}
            >
              Show log
            </button>
          </div>
          <div className="chat-header-actions">
            {live ? (
              <button
                type="button"
                className="g-menu-item"
                data-testid="chat-stop-session"
                onClick={item(onStop)}
                disabled={status === "stopping"}
              >
                Stop session
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="g-menu-item"
                  data-testid="chat-start"
                  data-test-resume={String(resumable)}
                  onClick={item(() => onStart(false))}
                >
                  {resumable ? "Resume session" : "Start session"}
                </button>
                {resumable ? (
                  <button
                    type="button"
                    className="g-menu-item"
                    data-testid="chat-start-fresh"
                    onClick={item(() => onStart(true))}
                  >
                    Start fresh
                  </button>
                ) : null}
              </>
            )}
          </div>
          {chat && inTauri() ? (
            <FolderContext key={chat.id} chatId={chat.id} status={status} />
          ) : null}
        </Popover>
      </div>
    </header>
  );
}

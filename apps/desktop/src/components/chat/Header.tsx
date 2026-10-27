import { AgentMark } from "@auracode/ui/graphite";
import { Ellipsis, GitBranch, PanelRight, SquareTerminal } from "lucide-react";
import { useState } from "react";
import type { AgentEntry, ChatSummary } from "../../bindings";
import { chatActivity } from "../../lib/chat/activity";
import type { ChatState } from "../../lib/chat/chatStore";
import { contextLabel, costLabel, folderStateLabel, statusWord } from "../../lib/chat/present";
import { hasProcess } from "../../lib/chat/transcript";
import { inTauri } from "../../lib/ipc";
import { ChatExportDialog } from "./ChatExportDialog";
import { projectName } from "./ChatList";
import { DebugBundleDialog } from "./DebugBundleDialog";
import { FolderContext } from "./FolderContext";
import { Popover } from "./Popover";
import { ProjectToolsDialog } from "./ProjectToolsDialog";

/**
 * The chat's header: the agent and the version that runs (the user's own binary behind an
 * adapter), the folder and its state, the status with what is happening, the session controls,
 * Show log, and the context used and session cost when the agent reports them.
 */
export function Header({
  state,
  listed = null,
  agent,
  resumable,
  onStart,
  onStop,
  onShowLog,
  onChanges,
  onHistory,
  onGit,
  changesOpen = false,
}: {
  readonly state: ChatState;
  /**
   * The chat as the chat list has it. Its folder state is the newer one: the list reloads after
   * a start fails or gets past the folder check, while the snapshot is from the join.
   */
  readonly listed?: ChatSummary | null;
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
  readonly changesOpen?: boolean;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
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
  const context = contextLabel(state.usage);
  const cost = costLabel(state.usage);
  const activity = chatActivity(state);
  const statusLabel = activity === "waiting" ? "Waiting on you" : statusWord(status);
  return (
    <header className="chat-header" data-testid="chat-header">
      <AgentMark
        agent={chat?.agent_id ?? agent?.id ?? "generic"}
        state={activity}
        size={16}
        label={`${name}, ${session?.detail ?? statusLabel}`}
      />
      <div className="chat-header-who">
        <span className="chat-header-agent" title={chat?.title ?? "New chat"}>
          {chat?.title ?? "New chat"}
        </span>
        {chat ? (
          <span className="chat-header-folder" title={chat.folder}>
            {projectName(chat.folder)}
            {folderState !== null ? <span className="chat-row-flag"> · {folderState}</span> : null}
          </span>
        ) : null}
      </div>
      <span
        className="chat-status"
        data-status={status}
        data-activity={activity}
        data-testid="chat-status"
        data-test-status={status}
        aria-live="polite"
      >
        {statusLabel}
        {session?.detail ? <span className="ui-muted"> · {session.detail}</span> : null}
      </span>
      {onChanges ? (
        <button
          type="button"
          className="chat-icon-button"
          aria-label="Changes"
          title="Changes"
          aria-expanded={changesOpen}
          onClick={(event) => {
            event.currentTarget.focus();
            onChanges();
          }}
        >
          <PanelRight size={16} />
        </button>
      ) : null}
      {onGit ? (
        <button
          type="button"
          className="chat-icon-button"
          aria-label="Git workspace"
          title="Git workspace"
          onClick={(event) => {
            event.currentTarget.focus();
            onGit();
          }}
        >
          <GitBranch size={16} />
        </button>
      ) : null}
      {chat && inTauri() ? (
        <button
          type="button"
          className="chat-icon-button"
          aria-label="Project tools"
          title="Terminal and editor"
          onClick={(event) => {
            event.currentTarget.focus();
            setToolsOpen(true);
          }}
        >
          <SquareTerminal size={16} />
        </button>
      ) : null}
      {toolsOpen && chat ? (
        <ProjectToolsDialog key={chat.id} chatId={chat.id} onClose={() => setToolsOpen(false)} />
      ) : null}
      <Popover
        label="Chat details and controls"
        className="chat-header-menu"
        trigger={<Ellipsis size={16} />}
      >
        <div className="chat-session-info">
          <strong>{name}</strong>
          <span>{version ?? "Version not reported"}</span>
          <span className="ui-mono">{ready?.path}</span>
        </div>
        {context !== null || cost !== null ? (
          <span className="ui-muted" data-testid="chat-usage">
            {[context, cost].filter((part) => part !== null).join(" · ")}
          </span>
        ) : null}
        {chat && inTauri() ? (
          <FolderContext key={chat.id} chatId={chat.id} status={status} />
        ) : null}
        <div className="ui-row">
          {chat && inTauri() ? (
            <>
              <button type="button" className="ui-button" onClick={() => setExportOpen(true)}>
                Export chat
              </button>
              <button type="button" className="ui-button" onClick={() => setDebugOpen(true)}>
                Copy debug bundle
              </button>
            </>
          ) : null}
          {onHistory ? (
            <button type="button" className="ui-button" onClick={onHistory}>
              Conversation history
            </button>
          ) : null}
          {live ? (
            <button
              type="button"
              className="ui-button"
              data-testid="chat-stop-session"
              onClick={onStop}
              disabled={status === "stopping"}
            >
              Stop session
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ui-button"
                data-kind="primary"
                data-testid="chat-start"
                data-test-resume={String(resumable)}
                onClick={() => onStart(false)}
              >
                {resumable ? "Resume session" : "Start session"}
              </button>
              {resumable ? (
                <button
                  type="button"
                  className="ui-button"
                  data-testid="chat-start-fresh"
                  onClick={() => onStart(true)}
                >
                  Start fresh
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            className="ui-button"
            data-kind="quiet"
            data-testid="chat-show-log"
            onClick={onShowLog}
          >
            Show log
          </button>
        </div>
        {state.actionError !== null ? (
          <span role="alert" className="ui-error" data-testid="chat-action-error">
            {state.actionError}
          </span>
        ) : null}
      </Popover>
      {exportOpen && chat ? (
        <ChatExportDialog key={chat.id} chatId={chat.id} onClose={() => setExportOpen(false)} />
      ) : null}
      {debugOpen && chat ? (
        <DebugBundleDialog key={chat.id} chatId={chat.id} onClose={() => setDebugOpen(false)} />
      ) : null}
    </header>
  );
}

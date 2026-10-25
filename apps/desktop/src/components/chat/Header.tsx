import type { AgentEntry } from "../../bindings";
import type { ChatState } from "../../lib/chat/chatStore";
import { contextLabel, costLabel, folderStateLabel, statusWord } from "../../lib/chat/present";
import { hasProcess } from "../../lib/chat/transcript";

/**
 * The chat's header: the agent and the version that runs (the user's own binary behind an
 * adapter), the folder and its state, the status with what is happening, the session controls,
 * Show log, and the context used and session cost when the agent reports them.
 */
export function Header({
  state,
  agent,
  resumable,
  onStart,
  onStop,
  onShowLog,
}: {
  readonly state: ChatState;
  /** The chat's agent as detection sees it, for the version that will run. */
  readonly agent: AgentEntry | null;
  /** There is an earlier session a start would continue. */
  readonly resumable: boolean;
  readonly onStart: (fresh: boolean) => void;
  readonly onStop: () => void;
  readonly onShowLog: () => void;
}) {
  const { chat, session } = state;
  const status = session?.status ?? chat?.status ?? "stopped";
  const live = hasProcess(status);
  const name = session?.agent_name ?? chat?.agent_name ?? agent?.name ?? "Agent";
  const readyVersion = agent?.availability.state === "ready" ? agent.availability.version : null;
  const version = session?.agent_version ?? readyVersion;
  const folderState = chat ? folderStateLabel(chat.folder_state) : null;
  const context = contextLabel(state.usage);
  const cost = costLabel(state.usage);
  return (
    <header className="chat-header">
      <div className="chat-header-who">
        <span className="chat-header-agent">
          {name}
          {version ? <span className="ui-muted"> · {version}</span> : null}
        </span>
        {chat ? (
          <span className="chat-header-folder">
            {chat.folder}
            {folderState !== null ? (
              <span className="chat-row-warning"> · {folderState}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <span className="chat-status" data-status={status} aria-live="polite">
        {statusWord(status)}
        {session?.detail ? <span className="ui-muted"> · {session.detail}</span> : null}
      </span>
      {context !== null || cost !== null ? (
        <span className="ui-muted">
          {[context, cost].filter((part) => part !== null).join(" · ")}
        </span>
      ) : null}
      <div className="ui-row">
        {live ? (
          <button
            type="button"
            className="ui-button"
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
              onClick={() => onStart(false)}
            >
              {resumable ? "Resume session" : "Start session"}
            </button>
            {resumable ? (
              <button type="button" className="ui-button" onClick={() => onStart(true)}>
                Start fresh
              </button>
            ) : null}
          </>
        )}
        <button type="button" className="ui-button" data-kind="quiet" onClick={onShowLog}>
          Show log
        </button>
      </div>
      {state.actionError !== null ? (
        <span role="alert" className="ui-error">
          {state.actionError}
        </span>
      ) : null}
    </header>
  );
}

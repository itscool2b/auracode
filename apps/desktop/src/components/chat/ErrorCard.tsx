import type { ErrorActions } from "../../lib/chat/present";
import type { ErrorItem } from "../../lib/chat/transcript";

/**
 * An error: its message, the redacted detail, and what can be done. Start failures offer Retry
 * (and Start fresh when continuing the earlier session may be what failed); turn errors, where the
 * session stays ready, offer nothing but resending; every card can show the protocol log.
 */
export function ErrorCard({
  item,
  actions,
  onRetry,
  onStartFresh,
  onShowLog,
}: {
  readonly item: ErrorItem;
  readonly actions: ErrorActions;
  readonly onRetry: () => void;
  readonly onStartFresh: () => void;
  readonly onShowLog: () => void;
}) {
  return (
    <div
      className="chat-block"
      data-kind="error"
      data-testid="item"
      data-test-kind="error"
      data-test-error-kind={item.errorKind}
    >
      <div className="chat-block-head">
        <span className="chat-block-title" data-testid="error-message">
          {item.message}
        </span>
      </div>
      {item.detail !== null && item.detail !== "" ? (
        <pre className="ui-pre" data-testid="error-detail">
          {item.detail}
        </pre>
      ) : null}
      <div className="ui-row">
        {actions.retry ? (
          <button
            type="button"
            className="g-button g-button-primary"
            data-testid="error-retry"
            onClick={onRetry}
          >
            Retry
          </button>
        ) : null}
        {actions.startFresh ? (
          <button
            type="button"
            className="g-button"
            data-testid="error-start-fresh"
            onClick={onStartFresh}
          >
            Start fresh
          </button>
        ) : null}
        <button
          type="button"
          className="g-button g-button-ghost"
          data-testid="error-show-log"
          onClick={onShowLog}
        >
          Show log
        </button>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { ChatState } from "../../lib/chat/chatStore";
import { renderCache } from "../../lib/chat/transcript";
import { useStickToBottom } from "../../lib/hooks";
import { type TurnActions, TurnView } from "./TurnView";

/**
 * The chat's turns: "Load earlier" at the top while older pages remain, a marker when the oldest
 * loaded turn was cut by a page, then every turn as it renders. Follows the bottom while content
 * grows, unless the reader scrolled up.
 */
export function Transcript({
  state,
  live,
  actions,
  onLoadEarlier,
}: {
  readonly state: ChatState;
  /** The session has a process (tools still running may finish). */
  readonly live: boolean;
  readonly actions: TurnActions;
  readonly onLoadEarlier: () => void;
}) {
  const [render] = useState(renderCache);
  const segments = useMemo(() => render(state.transcript, live), [render, state.transcript, live]);
  const scrollRef = useStickToBottom<HTMLDivElement>(state.transcript);
  const first = segments[0];
  return (
    <div ref={scrollRef} className="chat-transcript" role="log" aria-label="Transcript">
      <div className="chat-transcript-inner">
        {state.hasMore ? (
          <div className="ui-row">
            <button
              type="button"
              className="ui-button"
              data-kind="quiet"
              disabled={state.loadingEarlier}
              onClick={onLoadEarlier}
            >
              {state.loadingEarlier ? "Loading…" : "Load earlier"}
            </button>
            {state.earlierError !== null ? (
              <span role="alert" className="ui-error">
                {state.earlierError}
              </span>
            ) : null}
          </div>
        ) : null}
        {first?.partial ? (
          <p className="chat-marker">Earlier part of this turn not loaded</p>
        ) : null}
        {state.skipped > 0 ? (
          <p className="chat-marker">
            {state.skipped === 1
              ? "1 entry was written by a newer auracode and can't be shown."
              : `${state.skipped} entries were written by a newer auracode and can't be shown.`}
          </p>
        ) : null}
        {segments.map((segment) => (
          <TurnView key={segment.key} segment={segment} actions={actions} />
        ))}
        {segments.length === 0 && state.phase === "live" ? (
          <p className="chat-centered">Nothing here yet. Send a message to start.</p>
        ) : null}
      </div>
    </div>
  );
}

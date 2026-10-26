import { OrbitMark } from "@auracode/ui/orbit";
import { useEffect, useMemo, useState } from "react";
import { chatActivity, hasLiveLine } from "../../lib/chat/activity";
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
  const last = segments.at(-1);
  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  const activity = chatActivity(state);
  const agentId = state.chat?.agent_id ?? "generic";
  const agentName = state.session?.agent_name ?? state.chat?.agent_name ?? "Agent";
  const pendingLabel =
    activity === "waiting"
      ? "Waiting on you"
      : status === "starting"
        ? "Starting session"
        : status === "cancelling" || status === "stopping"
          ? "Stopping"
          : status === "running" && !hasLiveLine(last)
            ? last?.end === null
              ? "Thinking"
              : "Working"
            : null;
  return (
    <div
      ref={scrollRef}
      className="chat-transcript"
      role="log"
      aria-label="Transcript"
      data-testid="transcript"
    >
      <div className="chat-transcript-inner">
        {state.hasMore ? (
          <div className="ui-row">
            <button
              type="button"
              className="ui-button"
              data-kind="quiet"
              data-testid="load-earlier"
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
          <TurnView
            key={segment.key}
            segment={segment}
            actions={actions}
            agentId={agentId}
            agentName={agentName}
            active={status === "running" && segment === last && segment.end === null}
          />
        ))}
        {pendingLabel ? (
          <NowRow
            key={`${last?.key ?? "new"}:${pendingLabel}`}
            agentId={agentId}
            agentName={agentName}
            label={pendingLabel}
            activity={activity}
            delay={
              (pendingLabel === "Thinking" || pendingLabel === "Working") &&
              (last?.items.some((item) => item.kind !== "user") ?? false)
            }
          />
        ) : null}
        {segments.length === 0 && state.phase === "live" && pendingLabel === null ? (
          <p className="chat-centered">Nothing here yet. Send a message to start.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Gaps shorter than 1.2 seconds remain quiet; a new turn and requests show immediately. */
function NowRow({
  agentId,
  agentName,
  label,
  activity,
  delay,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly label: string;
  readonly activity: ReturnType<typeof chatActivity>;
  readonly delay: boolean;
}) {
  const [visible, setVisible] = useState(!delay);
  useEffect(() => {
    if (!delay) return;
    const timeout = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timeout);
  }, [delay]);
  if (!visible) return null;
  return (
    <div className="chat-now" data-state={activity} role="status">
      <OrbitMark
        agent={agentId}
        state={activity}
        size={16}
        label={`${agentName}, ${label.toLowerCase()}`}
      />
      <span>{label}</span>
    </div>
  );
}

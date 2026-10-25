import { memo } from "react";
import type { PlanEntry, UiAnswer } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { costLabel, type ErrorActions, tokensLabel } from "../../lib/chat/present";
import { type RenderedSegment, stopReasonLabel } from "../../lib/chat/transcript";
import { formatDuration } from "../../lib/format";
import { Answer } from "../Markdown";
import { ErrorCard } from "./ErrorCard";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { type BlobProps, ToolBlock } from "./ToolBlock";

/** What the items of a turn act on. */
export interface TurnActions extends BlobProps {
  readonly requests: ReadonlyMap<string, RequestState>;
  readonly onRespondPermission: (requestId: string, optionId: string | null) => void;
  readonly onRespondUi: (requestId: string, answer: UiAnswer | null) => void;
  /** The actions of an error card. */
  readonly errorActions: (
    key: string,
    kind: Parameters<typeof ErrorCard>[0]["item"]["errorKind"],
  ) => ErrorActions;
  readonly onStart: (fresh: boolean) => void;
  readonly onShowLog: () => void;
  /** The session has no process: a turn interrupted when auracode closed offers Resume session. */
  readonly canResume: boolean;
}

/** One turn (or the events between turns): its items in order, its plan, and its footer. */
export const TurnView = memo(function TurnView({
  segment,
  actions,
}: {
  readonly segment: RenderedSegment;
  readonly actions: TurnActions;
}) {
  return (
    <section
      className="chat-segment"
      data-kind={segment.turnId === null ? "outside" : "turn"}
      aria-label={segment.turnId === null ? "Between turns" : "Turn"}
    >
      {segment.items.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={item.key} className="chat-user">
                {item.text}
              </div>
            );
          case "message":
            return <Answer key={item.key} text={item.text} />;
          case "thought":
            return (
              <details key={item.key} className="chat-thought">
                <summary>
                  {item.completed
                    ? item.durationMs === null
                      ? "Thought"
                      : `Thought for ${formatDuration(item.durationMs)}`
                    : "Thinking…"}
                </summary>
                <p>{item.text}</p>
              </details>
            );
          case "tool":
            return (
              <ToolBlock
                key={item.key}
                tool={item}
                display={item.display}
                blobs={actions.blobs}
                onLoadBlob={actions.onLoadBlob}
              />
            );
          case "permission":
            return (
              <PermissionCard
                key={item.key}
                item={item}
                request={actions.requests.get(item.request.request_id)}
                onRespond={(optionId) =>
                  actions.onRespondPermission(item.request.request_id, optionId)
                }
                blobs={actions.blobs}
                onLoadBlob={actions.onLoadBlob}
              />
            );
          case "question":
            return (
              <QuestionCard
                key={item.key}
                item={item}
                request={actions.requests.get(item.request.request_id)}
                onRespond={(answer) => actions.onRespondUi(item.request.request_id, answer)}
              />
            );
          case "notice":
            return (
              <p key={item.key} className="chat-notice" data-level={item.level}>
                {item.message}
              </p>
            );
          case "error":
            return (
              <ErrorCard
                key={item.key}
                item={item}
                actions={actions.errorActions(item.key, item.errorKind)}
                onRetry={() => actions.onStart(false)}
                onStartFresh={() => actions.onStart(true)}
                onShowLog={actions.onShowLog}
              />
            );
          case "gap":
            return (
              <p key={item.key} className="chat-marker">
                Recent output isn't saved yet; it appears here when saving resumes.
              </p>
            );
          default: {
            const unreachable: never = item;
            throw new Error(`unhandled item: ${JSON.stringify(unreachable)}`);
          }
        }
      })}
      {segment.plan !== null && segment.plan.length > 0 ? <Plan entries={segment.plan} /> : null}
      <Footer segment={segment} canResume={actions.canResume} onStart={actions.onStart} />
    </section>
  );
});

function Plan({ entries }: { readonly entries: readonly PlanEntry[] }) {
  return (
    <section aria-label="Plan">
      <ul className="chat-plan">
        {entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan update replaces the whole list.
          <li key={index} data-status={entry.status}>
            <input
              type="checkbox"
              checked={entry.status === "completed"}
              readOnly
              aria-label={entry.status.replace("_", " ")}
            />{" "}
            {entry.content}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Why the turn ended, its tokens with their scope, how long it took, and the session's cost. */
function Footer({
  segment,
  canResume,
  onStart,
}: {
  readonly segment: RenderedSegment;
  readonly canResume: boolean;
  readonly onStart: (fresh: boolean) => void;
}) {
  const { end } = segment;
  if (end === null) return null;
  const parts = [stopReasonLabel(end)];
  if (end.usage !== null) parts.push(tokensLabel(end.usage));
  if (end.durationMs !== null) parts.push(formatDuration(end.durationMs));
  const cost = costLabel(segment.usage);
  if (cost !== null) parts.push(cost);
  return (
    <p className="chat-footer">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      {end.recovered && end.stopReason === "interrupted" && canResume ? (
        <button
          type="button"
          className="ui-button"
          data-kind="quiet"
          onClick={() => onStart(false)}
        >
          Resume session
        </button>
      ) : null}
    </p>
  );
}

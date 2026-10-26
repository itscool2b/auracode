import { CopyButton, OrbitMark } from "@auracode/ui/orbit";
import { Fragment, memo } from "react";
import type { PlanEntry, UiAnswer } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { costLabel, type ErrorActions, tokensLabel } from "../../lib/chat/present";
import { type RenderedSegment, stopReasonLabel } from "../../lib/chat/transcript";
import { formatDuration } from "../../lib/format";
import { Answer } from "../Markdown";
import { ErrorCard } from "./ErrorCard";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { ThoughtBlock } from "./ThoughtBlock";
import { type BlobProps, ToolBlock } from "./ToolBlock";
import { UserMessage } from "./UserMessage";

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
  agentId = "generic",
  agentName = "Agent",
  active = false,
  part,
  suppressByline = false,
}: {
  readonly segment: RenderedSegment;
  readonly actions: TurnActions;
  readonly agentId?: string;
  readonly agentName?: string;
  readonly active?: boolean;
  /** Virtual rows render one stable item or the footer; standalone previews render the whole turn. */
  readonly part?: number | "footer";
  readonly suppressByline?: boolean;
}) {
  const firstAgentItem = segment.items.findIndex((item) => item.kind !== "user");
  const selected = typeof part === "number" ? segment.items[part] : undefined;
  const entries =
    part === undefined
      ? segment.items.map((item, index) => ({ item, index }))
      : selected && typeof part === "number"
        ? [{ item: selected, index: part }]
        : [];
  const footer = part === undefined || part === "footer";
  return (
    <section
      className="chat-segment"
      data-kind={segment.turnId === null ? "outside" : "turn"}
      aria-label={segment.turnId === null ? "Between turns" : "Turn"}
      data-testid={part === undefined || part === 0 ? "segment" : "segment-part"}
      data-part={part ?? "whole"}
      data-test-kind={segment.turnId === null ? "outside" : "turn"}
      data-test-turn-id={segment.turnId ?? ""}
      data-test-segment-key={segment.key}
      data-test-prompt={segment.items.find((item) => item.kind === "user")?.text ?? ""}
      data-test-stop-reason={segment.end?.stopReason ?? ""}
      data-test-recovered={String(segment.end?.recovered ?? false)}
    >
      {entries.map(({ item, index }) => {
        const byline =
          index === firstAgentItem &&
          segment.turnId !== null &&
          !segment.partial &&
          !suppressByline ? (
            <div className="chat-byline">
              <OrbitMark agent={agentId} size={16} label={agentName} />
              <span>{agentName}</span>
            </div>
          ) : null;
        const content = (() => {
          switch (item.kind) {
            case "user":
              return <UserMessage key={item.key} item={item} />;
            case "message":
              return (
                <div
                  key={item.key}
                  data-testid="item"
                  data-test-kind="message"
                  data-test-completed={String(item.completed)}
                >
                  <Answer text={item.text} motion="none" />
                </div>
              );
            case "thought":
              return (
                <ThoughtBlock
                  key={item.key}
                  item={item}
                  active={active}
                  tail={index === segment.items.length - 1}
                  agentId={agentId}
                  agentName={agentName}
                />
              );
            case "tool":
              return (
                <ToolBlock
                  key={item.key}
                  tool={item}
                  agentId={agentId}
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
                <p
                  key={item.key}
                  className="chat-notice"
                  data-level={item.level}
                  data-testid="item"
                  data-test-kind="notice"
                  data-test-level={item.level}
                >
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
                <p key={item.key} className="chat-marker" data-testid="item" data-test-kind="gap">
                  Recent output isn't saved yet; it appears here when saving resumes.
                </p>
              );
            default: {
              const unreachable: never = item;
              throw new Error(`unhandled item: ${JSON.stringify(unreachable)}`);
            }
          }
        })();
        return (
          <Fragment key={item.key}>
            {byline}
            {content}
          </Fragment>
        );
      })}
      {footer && segment.plan !== null && segment.plan.length > 0 ? (
        <Plan entries={segment.plan} />
      ) : null}
      {footer ? (
        <Footer
          segment={segment}
          agentName={agentName}
          canResume={actions.canResume}
          onStart={actions.onStart}
        />
      ) : null}
    </section>
  );
});

function Plan({ entries }: { readonly entries: readonly PlanEntry[] }) {
  return (
    <section aria-label="Plan" data-testid="plan">
      <ul className="chat-plan">
        {entries.map((entry, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a plan update replaces the whole list.
            key={index}
            data-status={entry.status}
            data-testid="plan-entry"
            data-test-status={entry.status}
          >
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
  agentName,
  canResume,
  onStart,
}: {
  readonly segment: RenderedSegment;
  readonly agentName: string;
  readonly canResume: boolean;
  readonly onStart: (fresh: boolean) => void;
}) {
  const { end } = segment;
  if (end === null) return null;
  const parts = [stopReasonLabel(end)];
  if (end.usage !== null) parts.push(tokensLabel(end.usage));
  if (end.durationMs !== null) parts.push(formatDuration(end.durationMs));
  const cost = costLabel(segment.usage);
  if (cost !== null) parts.push(`${cost} session`);
  const response = segment.items
    .filter((item) => item.kind === "message")
    .map((item) => item.text)
    .join("\n\n");
  const receipt = [agentName, ...parts].join("\n");
  return (
    <p className="chat-footer" data-testid="turn-footer">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      <span className="chat-receipt-actions">
        {response ? <CopyButton text={response} label="Copy response as Markdown" /> : null}
        <CopyButton text={receipt} label="Copy turn receipt" caption="Receipt" />
      </span>
      {end.recovered && end.stopReason === "interrupted" && canResume ? (
        <button
          type="button"
          className="ui-button"
          data-kind="quiet"
          data-testid="turn-resume"
          onClick={() => onStart(false)}
        >
          Resume session
        </button>
      ) : null}
    </p>
  );
}

import type { PermissionDecision, Value } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { permissionResolutionLabel } from "../../lib/chat/present";
import type { PermissionItem } from "../../lib/chat/transcript";
import { type BlobProps, EventDetails, Locations, ToolContentView } from "./ToolBlock";

/** The most of a request's raw input the card shows; "Show full details" has the rest. */
const RAW_INPUT_CHARS = 2000;

/** A permission request's raw input, as readable text. */
export function rawInputSummary(input: Value | null): string | null {
  if (input === null) return null;
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  return text.length > RAW_INPUT_CHARS ? `${text.slice(0, RAW_INPUT_CHARS)}…` : text;
}

/** A decision as `data-test-decision` carries it: the chosen option's id, or `cancelled`. */
export function decisionMark(decision: PermissionDecision): string {
  return decision.type === "cancelled" ? "cancelled" : decision.option_id;
}

/**
 * The agent asks before it acts: title, input, content, one button per option, or Dismiss when
 * it offers none. Buttons disable while the answer is on its way; a resolved card says who closed
 * it (or the choice), and one the agent no longer waits for closes without a resolution.
 */
export function PermissionCard({
  item,
  request,
  onRespond,
  blobs,
  onLoadBlob,
}: {
  readonly item: PermissionItem;
  readonly request: RequestState | undefined;
  /** The option chosen; `null` dismisses the card (the agent hears `cancelled`). */
  readonly onRespond: (optionId: string | null) => void;
} & BlobProps) {
  const { request: ask, resolution } = item;
  const raw = rawInputSummary(ask.raw_input);
  const closed = resolution !== null || request?.gone === true;
  const busy = request?.busy === true;
  return (
    <div
      className="chat-block"
      data-kind="permission"
      data-resolved={closed}
      data-testid="item"
      data-test-kind="permission"
      data-test-request-id={ask.request_id}
      data-test-resolved-by={resolution?.by ?? ""}
      data-test-decision={resolution === null ? "" : decisionMark(resolution.decision)}
      data-test-gone={String(request?.gone === true)}
    >
      <div className="chat-block-head">
        <span className="chat-block-title" data-testid="permission-title">
          {ask.title}
        </span>
      </div>
      {raw !== null ? <pre className="ui-pre">{raw}</pre> : null}
      <Locations locations={ask.locations} />
      {ask.content.map((content, index) => (
        <ToolContentView
          // biome-ignore lint/suspicious/noArrayIndexKey: a request's content is positional.
          key={index}
          content={content}
          disclosureKey={`permission:${ask.request_id}:${index}`}
          blobs={blobs}
          onLoadBlob={onLoadBlob}
        />
      ))}
      {ask.truncated ? (
        <EventDetails truncation={ask.truncated} blobs={blobs} onLoadBlob={onLoadBlob} />
      ) : null}
      {resolution !== null ? (
        <p className="chat-resolution" data-testid="permission-resolution">
          {permissionResolutionLabel(resolution, ask.options)}
        </p>
      ) : request?.gone ? (
        <p className="chat-resolution" data-testid="permission-resolution">
          This request is no longer waiting for an answer.
        </p>
      ) : (
        <div className="ui-row">
          {ask.options.map((option) => (
            <button
              key={option.option_id}
              type="button"
              className={option.kind === "allow_once" ? "g-button g-button-primary" : "g-button"}
              data-testid="permission-option"
              data-test-option-id={option.option_id}
              data-test-option-kind={option.kind}
              disabled={busy}
              onClick={() => onRespond(option.option_id)}
            >
              {option.label}
            </button>
          ))}
          {ask.options.length === 0 ? (
            <button
              type="button"
              className="g-button"
              data-testid="permission-dismiss"
              disabled={busy}
              onClick={() => onRespond(null)}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      )}
      {request?.error ? (
        <span role="alert" className="ui-error" data-testid="permission-error">
          {request.error}
        </span>
      ) : null}
    </div>
  );
}

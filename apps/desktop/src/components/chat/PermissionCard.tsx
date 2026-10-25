import type { Value } from "../../bindings";
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
    <div className="chat-block" data-kind="permission" data-resolved={closed}>
      <div className="chat-block-head">
        <span className="chat-block-title">{ask.title}</span>
        {ask.kind !== null ? (
          <span className="chat-block-tag">{ask.kind.replace("_", " ")}</span>
        ) : null}
      </div>
      {raw !== null ? <pre className="ui-pre">{raw}</pre> : null}
      <Locations locations={ask.locations} />
      {ask.content.map((content, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a request's content is positional.
        <ToolContentView key={index} content={content} blobs={blobs} onLoadBlob={onLoadBlob} />
      ))}
      {ask.truncated ? (
        <EventDetails truncation={ask.truncated} blobs={blobs} onLoadBlob={onLoadBlob} />
      ) : null}
      {resolution !== null ? (
        <p className="chat-resolution">{permissionResolutionLabel(resolution, ask.options)}</p>
      ) : request?.gone ? (
        <p className="chat-resolution">This request is no longer waiting for an answer.</p>
      ) : (
        <div className="ui-row">
          {ask.options.map((option) => (
            <button
              key={option.option_id}
              type="button"
              className="ui-button"
              data-kind={option.kind === "allow_once" ? "primary" : undefined}
              disabled={busy}
              onClick={() => onRespond(option.option_id)}
            >
              {option.label}
            </button>
          ))}
          {ask.options.length === 0 ? (
            <button
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => onRespond(null)}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      )}
      {request?.error ? (
        <span role="alert" className="ui-error">
          {request.error}
        </span>
      ) : null}
    </div>
  );
}

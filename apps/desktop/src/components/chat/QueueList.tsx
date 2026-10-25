import type { QueuedPrompt } from "../../bindings";

/**
 * The prompts waiting behind the running turn (or the start), each with Remove; held ones (queued
 * before a stop, an error or a restart) wait for "Send queued".
 */
export function QueueList({
  queue,
  onRemove,
  onSendQueued,
}: {
  readonly queue: readonly QueuedPrompt[];
  readonly onRemove: (promptId: string) => void;
  readonly onSendQueued: () => void;
}) {
  if (queue.length === 0) return null;
  const held = queue.some((row) => row.held);
  return (
    <section aria-label="Queued messages">
      <ul className="chat-queue">
        {queue.map((row) => (
          <li key={row.prompt_id}>
            <span title={row.preview}>{row.preview || "(empty)"}</span>
            {row.held ? <span className="chat-held">held</span> : null}
            <button
              type="button"
              className="ui-button"
              data-kind="quiet"
              onClick={() => onRemove(row.prompt_id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {held ? (
        <div className="ui-row">
          <button type="button" className="ui-button" onClick={onSendQueued}>
            Send queued
          </button>
          <span className="ui-muted">
            Held messages wait for you after a stop, an error or a restart.
          </span>
        </div>
      ) : null}
    </section>
  );
}

import type { QueuedPrompt } from "../../bindings";

/**
 * The prompts waiting behind the running turn (or the start), each with Remove; held ones (queued
 * before a stop, an error or a restart) wait for "Send queued", which shows whenever the session
 * says some are held.
 */
export function QueueList({
  queue,
  held,
  onRemove,
  onSendQueued,
}: {
  readonly queue: readonly QueuedPrompt[];
  /** Some queued prompts are held (`SessionInfo.queue_held`). */
  readonly held: boolean;
  readonly onRemove: (promptId: string) => void;
  readonly onSendQueued: () => void;
}) {
  if (queue.length === 0 && !held) return null;
  return (
    <section aria-label="Queued messages">
      {queue.length > 0 ? (
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
      ) : null}
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

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
    <section className="chat-queue-list" aria-label="Queued messages" data-testid="queue">
      {queue.length > 0 ? (
        <ul className="chat-queue">
          {queue.map((row) => (
            <li
              key={row.prompt_id}
              data-testid="queued-prompt"
              data-test-prompt-id={row.prompt_id}
              data-test-held={String(row.held)}
            >
              <span title={row.preview} data-testid="queued-preview">
                {row.preview || "(empty)"}
              </span>
              {row.held ? <span className="chat-held">held</span> : null}
              <button
                type="button"
                className="g-button g-button-ghost g-button-28"
                data-testid="queued-remove"
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
          <button
            type="button"
            className="g-button g-button-28"
            data-testid="send-queued"
            onClick={onSendQueued}
          >
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

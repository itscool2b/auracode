import { X } from "lucide-react";
import type { QueuedPrompt } from "../../bindings";

/**
 * The prompts waiting behind the running turn (or the start), as one segment over the composer:
 * how many wait, then each message on its own row with a remove control. Held ones (queued before
 * a stop, an error or a restart) wait for "Send queued", which shows whenever the session says
 * some are held.
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
      <div className="chat-queue-head">
        <span>
          {queue.length === 0 ? "Nothing queued" : `${queue.length} queued${held ? " · held" : ""}`}
        </span>
        {held ? (
          <button
            type="button"
            className="g-button g-button-24"
            data-testid="send-queued"
            title="Held messages wait for you after a stop, an error or a restart."
            onClick={onSendQueued}
          >
            Send queued
          </button>
        ) : null}
      </div>
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
                className="g-button g-button-ghost g-button-icon g-button-24"
                data-testid="queued-remove"
                aria-label="Remove from the queue"
                title="Remove from the queue"
                onClick={() => onRemove(row.prompt_id)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {held ? (
        <p className="chat-queue-note">
          Held messages wait for you after a stop, an error or a restart.
        </p>
      ) : null}
    </section>
  );
}

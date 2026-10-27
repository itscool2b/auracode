import { ArrowDown, ArrowUp, Pencil, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { QueuedPrompt } from "../../bindings";

/** The row action that keeps focus after a move or an edit re-renders the queue. */
type RowAction = "edit" | "up" | "down";

/**
 * The prompts waiting behind the running turn (or the start), as one segment over the composer:
 * how many wait, then each message on its own row with its controls. Held ones (queued before
 * a stop, an error or a restart) wait for "Send queued", which shows whenever the session says
 * some are held.
 *
 * A row's words can be edited in place (Enter saves, Esc cancels), and Move up and Move down
 * reorder it from the keyboard as well as the pointer: the controls show under the hand and
 * whenever focus is in the row.
 */
export function QueueList({
  queue,
  held,
  onRemove,
  onSendQueued,
  onLoadText,
  onEdit,
  onMove,
}: {
  readonly queue: readonly QueuedPrompt[];
  /** Some queued prompts are held (`SessionInfo.queue_held`). */
  readonly held: boolean;
  readonly onRemove: (promptId: string) => void;
  readonly onSendQueued: () => void;
  /** The prompt's words as typed; `null` when it is gone or could not be read. */
  readonly onLoadText?: (promptId: string) => Promise<string | null>;
  /** Saves new words; answers why they were not saved, or `null`. */
  readonly onEdit?: (promptId: string, text: string) => Promise<string | null>;
  /** Moves the prompt to `index` (0 goes next). */
  readonly onMove?: (promptId: string, index: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const refocus = useRef<{ id: string; action: RowAction } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus returns after the queue or the editor changes.
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (!wanted || !list.current) return;
    const row = [...list.current.querySelectorAll<HTMLElement>("[data-test-prompt-id]")].find(
      (item) => item.dataset.testPromptId === wanted.id,
    );
    if (!row) return;
    refocus.current = null;
    const button = (action: RowAction) =>
      row.querySelector<HTMLButtonElement>(`[data-queue-action="${action}"]`);
    const target = button(wanted.action);
    // A row moved to an end has that direction disabled; the other one keeps the keyboard there.
    const usable =
      target && !target.disabled ? target : button(wanted.action === "up" ? "down" : "up");
    (usable && !usable.disabled ? usable : button("edit"))?.focus();
  }, [queue, editing]);
  if (queue.length === 0 && !held) return null;
  const startEditing = async (promptId: string) => {
    const text = await onLoadText?.(promptId);
    if (text !== null && text !== undefined) setEditing({ id: promptId, text });
  };
  const move = (promptId: string, index: number, action: RowAction) => {
    refocus.current = { id: promptId, action };
    void onMove?.(promptId, index);
  };
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
        <ul className="chat-queue" ref={list}>
          {queue.map((row, index) => (
            <li
              key={row.prompt_id}
              data-testid="queued-prompt"
              data-test-prompt-id={row.prompt_id}
              data-test-held={String(row.held)}
              data-editing={editing?.id === row.prompt_id ? "" : undefined}
            >
              {editing?.id === row.prompt_id && onEdit ? (
                <QueueEditor
                  initial={editing.text}
                  onCancel={() => {
                    refocus.current = { id: row.prompt_id, action: "edit" };
                    setEditing(null);
                  }}
                  onSave={async (text) => {
                    const error = await onEdit(row.prompt_id, text);
                    if (error === null) {
                      refocus.current = { id: row.prompt_id, action: "edit" };
                      setEditing(null);
                    }
                    return error;
                  }}
                />
              ) : (
                <>
                  <span title={row.preview} data-testid="queued-preview">
                    {row.preview || "(empty)"}
                  </span>
                  {row.held ? <span className="chat-held">held</span> : null}
                  {onEdit || onMove ? (
                    <span className="chat-queue-actions">
                      {onEdit && onLoadText ? (
                        <button
                          type="button"
                          className="g-button g-button-ghost g-button-icon g-button-24"
                          data-testid="queued-edit"
                          data-queue-action="edit"
                          aria-label="Edit queued message"
                          title="Edit"
                          onClick={() => void startEditing(row.prompt_id)}
                        >
                          <Pencil size={14} />
                        </button>
                      ) : null}
                      {onMove ? (
                        <>
                          <button
                            type="button"
                            className="g-button g-button-ghost g-button-icon g-button-24"
                            data-testid="queued-up"
                            data-queue-action="up"
                            aria-label="Move up in the queue"
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => move(row.prompt_id, index - 1, "up")}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="g-button g-button-ghost g-button-icon g-button-24"
                            data-testid="queued-down"
                            data-queue-action="down"
                            aria-label="Move down in the queue"
                            title="Move down"
                            disabled={index === queue.length - 1}
                            onClick={() => move(row.prompt_id, index + 1, "down")}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
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
                </>
              )}
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

/** A queued message's words in a field: Enter saves, Shift+Enter adds a line, Esc cancels. */
export function QueueEditor({
  initial,
  onSave,
  onCancel,
}: {
  readonly initial: string;
  /** Answers why the words were not saved, or `null`. */
  readonly onSave: (text: string) => Promise<string | null>;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: The value changes scrollHeight after React commits the textarea.
  useLayoutEffect(() => {
    if (!field.current) return;
    field.current.style.height = "0px";
    field.current.style.height = `${Math.min(160, Math.max(36, field.current.scrollHeight))}px`;
  }, [text]);
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      setError(await onSave(text));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="chat-queue-editor">
      <textarea
        ref={field}
        className="g-textarea"
        data-testid="queued-edit-input"
        aria-label="Queued message"
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        value={text}
        readOnly={saving}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            // Esc here only closes the editor; it never reaches the chat, where it stops a turn.
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {error !== null ? (
        <p id={errorId} className="chat-queue-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="chat-queue-editor-actions">
        <button
          type="button"
          className="g-button g-button-ghost g-button-24"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="g-button g-button-24"
          data-testid="queued-edit-save"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

import { BookOpen, ChevronRight, History, Pencil } from "lucide-react";
import { useCallback, useId, useState } from "react";
import type { ChatImageContext } from "../../bindings";
import type { MemoryContext } from "../../lib/chat/memoryContext";
import { steeringState, type UserItem } from "../../lib/chat/transcript";
import { MessageImages } from "./ChatImages";
import { CopyAction } from "./CopyAction";
import { useDisclosure } from "./DisclosureMemory";

export function UserMessage({
  item,
  onEdit,
  onRewind,
  settled = false,
  images,
}: {
  readonly item: UserItem;
  readonly onEdit?: () => void;
  /** Opens Changes against the files as they were before this message (ChangesPanel.tsx). */
  readonly onRewind?: () => void;
  readonly settled?: boolean;
  readonly images?: ChatImageContext;
}) {
  const delivery = steeringState(item, settled);
  const [expanded, setExpanded] = useDisclosure(item.key, "prompt", false);
  const [long, setLong] = useState(() => item.text.split("\n").length > 12);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setLong(node.scrollHeight > 252);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="chat-user-wrap" data-testid="item" data-test-kind="user">
      {/* The block and its actions keep to the words' width when memory opens wider below. */}
      {item.text || !item.memory ? (
        <div className="chat-user-row">
          <div className="chat-user" data-folded={long && !expanded}>
            <div className="chat-user-text" data-testid="prompt-text">
              <div ref={measure}>{item.text}</div>
            </div>
            {long ? (
              <button
                className="chat-user-expand"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Show less" : "Show all"}
              </button>
            ) : null}
          </div>
          <div className="chat-user-actions">
            {onEdit && !item.steering ? (
              <button
                type="button"
                className="chat-action"
                aria-label="Edit prompt"
                title="Edit and resend"
                onClick={onEdit}
              >
                <Pencil size={16} />
              </button>
            ) : null}
            {onRewind && !item.steering ? (
              <button
                type="button"
                className="chat-action"
                aria-label="Rewind to before this message"
                title="Rewind files to before this message"
                onClick={onRewind}
              >
                <History size={16} />
              </button>
            ) : null}
            <CopyAction text={item.text} label="Copy prompt" />
          </div>
        </div>
      ) : null}
      {images ? <MessageImages context={images} /> : null}
      {item.memory ? <AttachedMemory itemKey={item.key} memory={item.memory} /> : null}
      {delivery ? (
        <div className="chat-steering-status" role="status" data-steering-state={delivery}>
          <span>
            {
              {
                pending: "Sending to current turn…",
                accepted: "Delivered to current turn",
                rejected: "Not delivered",
                unconfirmed: "Delivery unconfirmed",
              }[delivery]
            }
          </span>
          {item.steering?.detail ? <span>{item.steering.detail}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The project memory Aura sent along with a message, folded to one quiet line under it. The
 * agent received all of it; the reader opens it only to check what that was.
 */
function AttachedMemory({
  itemKey,
  memory,
}: {
  readonly itemKey: string;
  readonly memory: MemoryContext;
}) {
  const [open, setOpen] = useDisclosure(itemKey, "memory", false);
  const body = useId();
  return (
    <div className="chat-user-memory" data-testid="prompt-memory">
      <button
        type="button"
        className="chat-user-memory-toggle"
        aria-expanded={open}
        aria-controls={body}
        title="Sent to the agent with this message as reference"
        onClick={() => setOpen(!open)}
      >
        <BookOpen size={14} aria-hidden="true" />
        <span>Project memory</span>
        <ChevronRight className="chat-disclosure" size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="chat-user-memory-body" id={body}>
          <p className="chat-user-memory-note">
            Sent to the agent with this message as reference.
            {memory.editedBy ? ` ${memory.editedBy}` : ""}
          </p>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a long memory scrolls by keyboard. */}
          <pre className="chat-user-memory-text" tabIndex={0}>
            {memory.markdown}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

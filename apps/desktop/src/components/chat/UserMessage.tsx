import { Pencil } from "lucide-react";
import { useCallback, useState } from "react";
import { steeringState, type UserItem } from "../../lib/chat/transcript";
import { CopyAction } from "./CopyAction";
import { useDisclosure } from "./DisclosureMemory";

export function UserMessage({
  item,
  onEdit,
  settled = false,
}: {
  readonly item: UserItem;
  readonly onEdit?: () => void;
  readonly settled?: boolean;
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
        <CopyAction text={item.text} label="Copy prompt" />
      </div>
    </div>
  );
}

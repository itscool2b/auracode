import { CopyButton } from "@auracode/ui/orbit";
import { useCallback, useState } from "react";
import type { UserItem } from "../../lib/chat/transcript";
import { useDisclosure } from "./DisclosureMemory";

export function UserMessage({
  item,
  onEdit,
}: {
  readonly item: UserItem;
  readonly onEdit?: () => void;
}) {
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
      <div className="chat-user-actions">
        {onEdit ? (
          <button type="button" onClick={onEdit}>
            Edit prompt
          </button>
        ) : null}
        <CopyButton text={item.text} label="Copy prompt" />
      </div>
    </div>
  );
}

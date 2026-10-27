import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatFolderContext } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { chatFolderContext } from "../../lib/ipc";

export function FolderContext({
  chatId,
  status,
}: {
  readonly chatId: string;
  readonly status: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ChatFolderContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: status invalidates a previous driver generation's folder list.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setValue(null);
    setError(null);
    void chatFolderContext(chatId).then(
      (next) => {
        if (active) setValue(next);
      },
      (failure) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [chatId, status, open]);
  return (
    <div className="chat-folder-context">
      <button
        type="button"
        className="g-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <FolderOpen size={14} /> Folders shared with agent
      </button>
      {open ? (
        error ? (
          <p role="alert" className="ui-error">
            {error}
          </p>
        ) : value ? (
          <FolderContextView value={value} />
        ) : (
          <p role="status" className="ui-muted">
            Checking project folders…
          </p>
        )
      ) : null}
    </div>
  );
}

export function FolderContextView({ value }: { readonly value: ChatFolderContext }) {
  return (
    <section aria-label="Agent folder context">
      <p className="ui-muted">
        {value.active ? "Shared with this session" : "Prepared for the next session"}
      </p>
      <ul>
        <li>
          <span>Primary</span>
          <code>{value.primary || "No local folder"}</code>
        </li>
        {value.additional.map((path) => (
          <li key={path}>
            <span>Additional</span>
            <code>{path}</code>
          </li>
        ))}
      </ul>
      {value.notices.map((notice) => (
        <p className="ui-muted" key={notice}>
          {notice}
        </p>
      ))}
      {value.active && value.supports_additional ? (
        <p className="ui-muted">Stop and restart the session to use newly added project folders.</p>
      ) : null}
      <p className="ui-muted">
        These folders provide working context. Access still follows the agent's permissions and
        autonomy mode.
      </p>
    </section>
  );
}

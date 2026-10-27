import { useState } from "react";
import { commands } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { settle } from "../../lib/ipc";
import { Modal } from "./Modal";
import "./chat-export.css";

const exportSavedChat = (chatId: string) => settle(commands.chatExportMarkdown(chatId));

export function ChatExportDialog({
  chatId,
  onClose,
  save = exportSavedChat,
}: {
  readonly chatId: string;
  readonly onClose: () => void;
  readonly save?: (chatId: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);
  const exportChat = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCanceled(false);
    try {
      const result = await save(chatId);
      setPath(result);
      setCanceled(result === null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Export this chat" onClose={onClose} closeDisabled={busy}>
      <div className="chat-export-content">
        <p>
          Save a readable Markdown copy of the messages and tool activity already saved in this
          chat. A running response may be incomplete. Queued drafts and attachment files are not
          included.
        </p>
        <p>
          This copy is unencrypted. Anyone with access to the file can read it, including any
          private information in your conversation. Choose a new file name; existing files are never
          replaced.
        </p>
        {path ? (
          <p role="status" style={{ overflowWrap: "anywhere" }}>
            Saved to {path}
          </p>
        ) : null}
        {canceled ? <p role="status">Export canceled. No file was saved.</p> : null}
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="chat-export-actions">
          <button type="button" className="g-button" disabled={busy} onClick={onClose}>
            {path ? "Done" : "Cancel"}
          </button>
          {!path ? (
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={() => void exportChat()}
            >
              {busy ? "Saving…" : "Choose export location"}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

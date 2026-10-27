import { useState } from "react";
import { commands } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { settle } from "../../lib/ipc";
import { Modal } from "./Modal";
import "./chat-export.css";

const prepareBundle = (chatId: string) => settle(commands.chatDebugBundle(chatId));
const copyBundle = (text: string) => navigator.clipboard.writeText(text);

export function DebugBundleDialog({
  chatId,
  onClose,
  prepare = prepareBundle,
  copy = copyBundle,
}: {
  readonly chatId: string;
  readonly onClose: () => void;
  readonly prepare?: (chatId: string) => Promise<string>;
  readonly copy?: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (text === null) setText(await prepare(chatId));
      else {
        await copy(text);
        setCopied(true);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Copy debug bundle" onClose={onClose}>
      <div className="chat-export-content">
        <p>
          Prepare a local preview of this chat’s newest saved protocol log and app version. Known
          tokens are redacted, but messages, code and file paths can remain. Review and edit the
          preview before copying. Nothing is uploaded.
        </p>
        {text !== null ? (
          <label className="debug-bundle-preview">
            Bundle preview
            <textarea
              className="g-textarea debug-bundle-text"
              value={text}
              spellCheck={false}
              onChange={(event) => {
                setText(event.target.value);
                setCopied(false);
              }}
              rows={14}
            />
          </label>
        ) : null}
        {copied ? <p role="status">Copied to clipboard. Review before sharing.</p> : null}
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="chat-export-actions">
          <button type="button" className="g-button" disabled={busy} onClick={onClose}>
            {copied ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="g-button g-button-primary"
            disabled={busy || text === ""}
            onClick={() => void run()}
          >
            {busy ? "Working…" : text === null ? "Prepare preview" : "Copy reviewed bundle"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

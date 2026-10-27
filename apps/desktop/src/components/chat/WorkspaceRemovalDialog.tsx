import "./workspace-removal.css";
import { useEffect, useRef, useState } from "react";
import type {
  RemovedWorkspace,
  WorkspaceRemovalPreview,
  WorkspaceRemovalTarget,
} from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type WorkspaceRemovalApi, workspaceRemovalApi } from "../../lib/workspaceRemoval";
import { Modal } from "./Modal";

export function WorkspaceRemovalDialog({
  target,
  onClose,
  onChanged,
  api = workspaceRemovalApi,
}: {
  readonly target: WorkspaceRemovalTarget | null;
  readonly onClose: () => void;
  readonly onChanged: () => Promise<void>;
  readonly api?: WorkspaceRemovalApi;
}) {
  const [items, setItems] = useState<RemovedWorkspace[]>([]);
  const [review, setReview] = useState<WorkspaceRemovalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setBusy(true);
    const work = target
      ? api.review(target, "remove").then((value) => {
          if (generation.current === current) setReview(value);
        })
      : api.list().then((value) => {
          if (generation.current === current) setItems(value);
        });
    void work
      .catch((reason) => {
        if (generation.current === current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (generation.current === current) {
          setBusy(false);
          setLoaded(true);
        }
      });
    return () => {
      generation.current++;
    };
  }, [api, target]);
  const restore = async (item: RemovedWorkspace) => {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.review(item.target, "restore"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!review || busy) return;
    const token = review.token;
    setReview(null);
    setBusy(true);
    setError(null);
    try {
      await api.apply(token);
      await onChanged();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={target ? "Review removal" : "Removed projects and folders"} onClose={onClose}>
      <div className="workspace-removal-content">
        {review ? (
          <>
            <h3>
              {review.action === "remove" ? "Remove" : "Restore"} {review.name}
            </h3>
            <p>
              {review.chat_count} saved {review.chat_count === 1 ? "chat" : "chats"} affected.
            </p>
            {review.notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
            {review.folders.length > 0 ? (
              <details>
                <summary>Folders on this device</summary>
                <ul>
                  {review.folders.map((folder) => (
                    <li key={folder} className="ui-mono">
                      {folder}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <button
              type="button"
              className="ui-button"
              data-kind="primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              {review.action === "remove" ? "Remove from workspace" : "Restore saved item"}
            </button>
          </>
        ) : !target && loaded ? (
          <>
            <p>Files were not deleted. Restore an item to see its saved chats again.</p>
            {items.length >= 1000 ? (
              <p>
                Showing up to 1,000 recent projects and 1,000 folders. Restoring items reveals older
                entries.
              </p>
            ) : null}
            {items.length === 0 ? (
              <p>No removed projects or folders.</p>
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={`${item.target.kind}:${item.target.id}`}>
                    <strong>{item.name}</strong>{" "}
                    <span>
                      {item.target.kind === "folder" ? `Folder in ${item.project_name}` : "Project"}{" "}
                      · {item.chat_count} chats
                    </span>
                    {item.restore_unavailable ? <p>{item.restore_unavailable}</p> : null}
                    <button
                      className="ui-button"
                      type="button"
                      disabled={busy || item.restore_unavailable !== null}
                      onClick={() => void restore(item)}
                    >
                      Review restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        {busy ? (
          <p role="status">{review ? "Working…" : "Reading or saving workspace metadata…"}</p>
        ) : null}
        {error ? (
          <p role="alert" className="ui-error">
            {error} Close this dialog and review the item again.
          </p>
        ) : null}
        <footer>
          <button className="ui-button" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </Modal>
  );
}

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatSummary, WorkspaceChat } from "../../bindings";
import { hasProcess } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import { busyElsewhere, moveChat } from "../../lib/chatMove";
import { errorMessage } from "../../lib/errors";
import type { WorkspaceStore } from "../../lib/workspace";
import { Modal } from "./Modal";

/**
 * The busy-folder warning New chat shows, for a move: the chats already working in the folder
 * and one explicit checkbox. Nothing overrides the warning until it is checked.
 */
export function MoveBusyWarning({
  busy,
  acknowledged,
  onAcknowledge,
}: {
  readonly busy: readonly ChatSummary[];
  readonly acknowledged: boolean;
  readonly onAcknowledge: (value: boolean) => void;
}) {
  if (busy.length === 0) return null;
  return (
    <div className="chat-move-busy" data-testid="move-busy">
      <strong>This folder has active work</strong>
      <span className="chat-move-busy-names">
        {busy.map((chat) => chat.title ?? chat.agent_name).join(", ")}
      </span>
      <label>
        <input
          type="checkbox"
          data-testid="move-busy-acknowledge"
          checked={acknowledged}
          onChange={(event) => onAcknowledge(event.currentTarget.checked)}
        />
        Move this chat into it anyway. Agents may edit the same files.
      </label>
    </div>
  );
}

export function ChatActionsDialog({
  entry,
  chat,
  store,
  transport,
  onChanged,
  onClose,
}: {
  readonly entry: WorkspaceChat;
  readonly chat: ChatSummary;
  readonly store: WorkspaceStore;
  readonly transport: Transport;
  readonly onChanged: (chat: ChatSummary) => void;
  readonly onClose: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [title, setTitle] = useState(chat.title ?? "");
  const [projectId, setProjectId] = useState(entry.project_id);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState<readonly ChatSummary[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const live = hasProcess(chat.status);
  const folders =
    state.data?.projects
      .find((project) => project.id === projectId)
      ?.folders.filter((folder) => folder.path !== null) ?? [];
  // A new destination folder starts unacknowledged: the warning is about that folder only.
  useEffect(() => {
    let current = true;
    setBusy([]);
    setAcknowledged(false);
    setCheckError(null);
    if (folderId)
      void store.api.preview(folderId).then(
        (preview) => {
          if (current) setBusy(busyElsewhere(preview, chat.id));
        },
        (error) => {
          if (current) setCheckError(errorMessage(error));
        },
      );
    return () => {
      current = false;
    };
  }, [folderId, store, chat.id]);
  const save = (operation: () => Promise<WorkspaceChat>) =>
    void store.perform(operation).then((result) => {
      if (result) {
        onChanged(result.chat);
        onClose();
      }
    });
  const unchanged = projectId === entry.project_id && (!folderId || folderId === entry.folder_id);
  const move = () =>
    void store
      .perform(() =>
        moveChat(store.api, chat.id, { projectId, folderId: folderId || null }, acknowledged),
      )
      .then((outcome) => {
        if (!outcome) return;
        if (outcome.kind === "busy") {
          setBusy(outcome.busy);
          return;
        }
        onChanged(outcome.chat.chat);
        onClose();
      });
  return (
    <Modal title="Chat options" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(() => store.api.rename(chat.id, title));
        }}
      >
        <label className="ui-field">
          Chat name
          <input
            className="g-input"
            value={title}
            maxLength={512}
            required
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <button type="submit" className="g-button" disabled={state.busy || !title.trim()}>
          Rename chat
        </button>
        <div className="dialog-section">
          <button
            type="button"
            className="g-button"
            disabled={state.busy}
            onClick={() => save(() => store.api.pin(chat.id, !entry.pinned))}
          >
            {entry.pinned ? "Unpin chat" : "Pin chat"}
          </button>
          <button
            type="button"
            className="g-button"
            disabled={state.busy}
            onClick={() => save(() => store.api.archive(chat.id, !entry.archived))}
          >
            {entry.archived ? "Restore chat" : "Archive chat"}
          </button>
          <p>Archived chats stay saved and can be restored from the sidebar.</p>
        </div>
        <div className="dialog-section">
          <label className="ui-field">
            Move to project
            <select
              className="g-select"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.currentTarget.value);
                setFolderId("");
              }}
            >
              {state.data?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {folders.length > 0 ? (
            <label className="ui-field">
              Folder
              <select
                className="g-select"
                data-testid="move-folder"
                value={folderId}
                onChange={(event) => setFolderId(event.currentTarget.value)}
              >
                <option value="">Its current folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.display_name} ({folder.path})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p>
            {folderId
              ? "The chat works in this folder from its next turn. Files are not moved."
              : "The chat keeps its working folder. Files stay where they are."}
          </p>
          <MoveBusyWarning
            busy={busy}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
          />
          {checkError ? (
            <p role="alert" className="ui-error">
              {checkError}
            </p>
          ) : null}
          {live ? (
            <>
              <p>Stop the session before moving this chat.</p>
              <button
                type="button"
                className="g-button"
                disabled={state.busy || chat.status === "stopping"}
                onClick={() => void store.perform(() => transport.stop(chat.id))}
              >
                Stop session
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="g-button"
            disabled={state.busy || live || unchanged || (busy.length > 0 && !acknowledged)}
            onClick={move}
          >
            Move chat
          </button>
        </div>
        {state.error ? (
          <p role="alert" className="ui-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

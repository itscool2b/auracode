import { useState, useSyncExternalStore } from "react";
import type { ChatSummary, WorkspaceChat } from "../../bindings";
import { hasProcess } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import type { WorkspaceStore } from "../../lib/workspace";
import { Modal } from "./Modal";

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
  const live = hasProcess(chat.status);
  const save = (operation: () => Promise<WorkspaceChat>) =>
    void store.perform(operation).then((result) => {
      if (result) {
        onChanged(result.chat);
        onClose();
      }
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
            className="ui-input"
            value={title}
            maxLength={512}
            required
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <button type="submit" className="ui-button" disabled={state.busy || !title.trim()}>
          Rename chat
        </button>
        <div className="chat-dialog-section">
          <button
            type="button"
            className="ui-button"
            disabled={state.busy}
            onClick={() => save(() => store.api.pin(chat.id, !entry.pinned))}
          >
            {entry.pinned ? "Unpin chat" : "Pin chat"}
          </button>
          <button
            type="button"
            className="ui-button"
            disabled={state.busy}
            onClick={() => save(() => store.api.archive(chat.id, !entry.archived))}
          >
            {entry.archived ? "Restore chat" : "Archive chat"}
          </button>
          <p>Archived chats stay saved and can be restored from the sidebar.</p>
        </div>
        <div className="chat-dialog-section">
          <label className="ui-field">
            Move to project
            <select
              className="ui-select"
              value={projectId}
              onChange={(event) => setProjectId(event.currentTarget.value)}
            >
              {state.data?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <p>The chat keeps its working folder. Files stay where they are.</p>
          {live ? (
            <>
              <p>Stop the session before moving this chat.</p>
              <button
                type="button"
                className="ui-button"
                disabled={state.busy || chat.status === "stopping"}
                onClick={() => void store.perform(() => transport.stop(chat.id))}
              >
                Stop session
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ui-button"
            disabled={state.busy || live || projectId === entry.project_id}
            onClick={() =>
              save(() =>
                store.api.move(chat.id, {
                  project_id: projectId,
                  folder_id: null,
                  allow_busy_folder: false,
                }),
              )
            }
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

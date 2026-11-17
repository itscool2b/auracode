import { type ReactNode, useRef, useState } from "react";
import type { FolderBlockers } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { blockerDoing, blockerName, type FolderBusyApi, folderBusyApi } from "../../lib/folderBusy";

/**
 * What stands in the way of a change to a folder, as Rust named it: each chat working there,
 * with its project and what it is doing, and the project terminals open there. One action
 * clears the chats: "Stop these chats" stops them, waits until their agents are gone, then hands
 * back to the change, which tries again. Closing a terminal stays the person's own choice.
 * `children` adds a choice of the screen's own (New chat's "start anyway").
 */
export function FolderBusy({
  blockers,
  onStopped,
  api = folderBusyApi,
  className = "chat-move-busy",
  heading,
  children,
}: {
  readonly blockers: FolderBlockers;
  /** The chats are stopped and their agents gone: try the change again. */
  readonly onStopped: () => void;
  readonly api?: Pick<FolderBusyApi, "stop">;
  /** The screen's own notice style (New chat's, Chat options'). */
  readonly className?: string;
  readonly heading?: string;
  readonly children?: ReactNode;
}) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const chats = blockers.chats;
  const stop = () => {
    if (running.current || chats.length === 0) return;
    running.current = true;
    setStopping(true);
    setError(null);
    api.stop(chats.map((chat) => chat.chat_id)).then(
      (report) => {
        running.current = false;
        setStopping(false);
        if (report.kept.length > 0) {
          setError(
            report.kept.length === 1
              ? "A chat is open in its terminal. Close its terminal, then try again."
              : `${report.kept.length} chats are open in their terminals. Close them, then try again.`,
          );
          return;
        }
        if (report.stopping.length > 0) {
          setError(
            report.stopping.length === 1
              ? "A chat is still stopping. Try again in a moment."
              : `${report.stopping.length} chats are still stopping. Try again in a moment.`,
          );
          return;
        }
        onStopped();
      },
      (reason: unknown) => {
        running.current = false;
        setStopping(false);
        setError(errorMessage(reason));
      },
    );
  };
  // A chat open in its terminal stops by its terminal closing, so the action says that.
  const terminalsOnly = chats.length > 0 && chats.every((chat) => chat.state === "terminal");
  const action = terminalsOnly
    ? chats.length === 1
      ? "Close its terminal"
      : "Close their terminals"
    : chats.length === 1
      ? "Stop this chat"
      : "Stop these chats";
  const title =
    heading ??
    (chats.length === 1
      ? "A chat is working in this folder"
      : chats.length > 1
        ? "Chats are working in this folder"
        : "This folder is in use");
  return (
    <div className={className} data-testid="folder-busy">
      <strong>{title}</strong>
      {chats.map((chat) => (
        <span className="chat-move-busy-names" key={chat.chat_id} data-test-blocker={chat.chat_id}>
          {blockerName(chat)}: {blockerDoing(chat.state)}
        </span>
      ))}
      {blockers.terminals > 0 ? (
        <span className="chat-move-busy-names">
          {blockers.terminals === 1
            ? "A project terminal is open in this folder. Close it to continue."
            : `${blockers.terminals} project terminals are open in this folder. Close them to continue.`}
        </span>
      ) : null}
      {children}
      {chats.length > 0 ? (
        <div className="new-chat-actions">
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            data-testid="folder-busy-stop"
            disabled={stopping}
            onClick={stop}
          >
            {stopping ? "Stopping…" : action}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="ui-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type ChatSummary, commands, type WorkspaceSnapshot } from "../bindings";
import { inTauri } from "./ipc";

/** What the chats screen knows when a notification asks it to open a chat. */
export interface NavigationLists {
  /** The live chat list (never archived chats); `null` until it loads. */
  readonly chats: readonly ChatSummary[] | null;
  /** The live list failed to load. */
  readonly chatsFailed: boolean;
  /** The workspace, with archived chats; `null` when there is none or it has not loaded. */
  readonly workspace: WorkspaceSnapshot | null;
  /** A workspace exists and is still loading (no data and no error yet). */
  readonly workspacePending: boolean;
}

/** Open a known chat (in the archived view when it is archived), wait for the lists, or ignore. */
export type NavigationTarget =
  | { readonly kind: "open"; readonly chatId: string; readonly archived: boolean }
  | { readonly kind: "wait" }
  | { readonly kind: "ignore" };

/**
 * Checks a notification's chat ID against the chats this profile actually has before anything is
 * selected. Unknown IDs (a deleted chat, another profile's notification) change nothing, so the
 * screen never shows a blank selection; an archived chat opens with the archived view.
 */
export function navigationTarget(chatId: string, lists: NavigationLists): NavigationTarget {
  const live = lists.chats?.some((chat) => chat.id === chatId) ?? false;
  if (lists.workspace) {
    const entry = lists.workspace.chats.find((item) => item.chat.id === chatId);
    if (entry) return { kind: "open", chatId, archived: entry.archived };
    // A chat created moments ago can reach the live list before the workspace refreshes.
    return live ? { kind: "open", chatId, archived: false } : { kind: "ignore" };
  }
  if (live) return { kind: "open", chatId, archived: false };
  if (lists.workspacePending || (lists.chats === null && !lists.chatsFailed))
    return { kind: "wait" };
  return { kind: "ignore" };
}

/** Rust retains notification navigation while the webview is suspended or reloading. */
export function subscribeNativeNavigation(open: (chatId: string) => void): () => void {
  if (!inTauri()) return () => {};
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const consume = () => {
    if (disposed) return;
    void commands
      .shellTakeNavigation()
      .then((id) => {
        if (id) open(id);
      })
      .catch(() => {
        // A closing window cannot accept navigation. Rust owns any subsequent wake request.
      });
  };
  void listen("auracode-open-chat", consume)
    .then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        consume();
      }
    })
    .catch(() => {
      consume();
    });
  window.addEventListener("focus", consume);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener("focus", consume);
  };
}

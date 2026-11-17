import {
  type BlockerState,
  type ChatSummary,
  type ChatsStopped,
  commands,
  type FolderBlocker,
  type FolderBlockers,
  type FolderScope,
} from "../bindings";
import { CommandError, settle } from "./ipc";

/** Presentation transport only: Rust decides what is in a folder's way and stops it. */
export interface FolderBusyApi {
  /** Stops these chats and resolves once their agents' processes are gone. */
  readonly stop: (chatIds: string[]) => Promise<ChatsStopped>;
  readonly blockers: (scope: FolderScope) => Promise<FolderBlockers>;
}

export const folderBusyApi: FolderBusyApi = {
  stop: (chatIds) => settle(commands.chatsStop(chatIds)),
  blockers: (scope) => settle(commands.folderBlockers(scope)),
};

/** What a refused folder change named as in its way, when the refusal was that. */
export function busyFolder(error: unknown): FolderBlockers | null {
  if (!(error instanceof CommandError) || error.code !== "folder_busy") return null;
  return error.blockers ?? { chats: [], terminals: 0 };
}

/** A chat as the person knows it: its title (or its agent's), and its project. */
export function blockerName(blocker: FolderBlocker): string {
  const name = blocker.title ?? `${blocker.agent_name} chat`;
  return blocker.project ? `${name} in ${blocker.project}` : name;
}

const DOING: Record<BlockerState, string> = {
  working: "working",
  waiting: "waiting for your answer",
  terminal: "open in a terminal",
  idle: "idle",
};

export function blockerDoing(state: BlockerState): string {
  return DOING[state];
}

/**
 * New chat's and Move chat's busy-folder lists as blockers: the chats working in the folder (or
 * waiting for an answer there), each with its project.
 */
export function blockersFromChats(
  chats: readonly ChatSummary[],
  projectOf: (chatId: string) => string | null,
): FolderBlockers {
  return {
    chats: chats.map((chat) => ({
      chat_id: chat.id,
      title: chat.title,
      agent_name: chat.agent_name,
      project: projectOf(chat.id),
      state: chat.needs_attention ? "waiting" : "working",
    })),
    terminals: 0,
  };
}

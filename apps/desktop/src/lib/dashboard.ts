import type { ChatSummary, SessionStatus } from "../bindings";
import { folderStateLabel } from "./chat/present";

/**
 * The Dashboard's board: every chat sorted into what it asks of you. A chat that waits on you,
 * failed or lost its folder needs you; one whose agent runs is working; one whose agent went quiet
 * in the last day is finished. Older quiet chats stay in the sidebar only.
 */
export type Lane = "attention" | "working" | "finished";

export const LANES: readonly Lane[] = ["attention", "working", "finished"];

export const LANE_TITLES: Record<Lane, string> = {
  attention: "Needs you",
  working: "Working",
  finished: "Finished",
};

/** How long a quiet chat stays under Finished after its last activity. */
export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;

const WORKING: ReadonlySet<SessionStatus> = new Set([
  "running",
  "starting",
  "cancelling",
  "stopping",
]);

export function laneOf(chat: ChatSummary, now: number): Lane | null {
  if (
    chat.needs_attention ||
    chat.status === "auth_required" ||
    chat.status === "failed" ||
    folderStateLabel(chat.folder_state) !== null
  )
    return "attention";
  if (WORKING.has(chat.status)) return "working";
  return now - chat.updated_at <= FINISHED_WINDOW_MS ? "finished" : null;
}

/** What a card says the chat is doing, or why it needs you. */
export function stateLine(chat: ChatSummary): string {
  if (chat.needs_attention) return "Waiting for your answer";
  const folder = folderStateLabel(chat.folder_state);
  if (folder !== null) return folder.charAt(0).toUpperCase() + folder.slice(1);
  switch (chat.status) {
    case "auth_required":
      return "Needs you to sign in";
    case "failed":
      return "Couldn't start";
    case "starting":
      return "Starting";
    case "cancelling":
      return "Stopping its turn";
    case "stopping":
      return "Stopping";
    case "running":
      return "Working";
    case "ready":
      return "Finished its turn";
    case "stopped":
      return "Agent stopped";
  }
}

export type Board = Record<Lane, ChatSummary[]>;

/** The chats in their lanes, most recent activity first. */
export function boardOf(chats: readonly ChatSummary[], now: number): Board {
  const board: Board = { attention: [], working: [], finished: [] };
  for (const chat of chats) {
    const lane = laneOf(chat, now);
    if (lane !== null) board[lane].push(chat);
  }
  for (const lane of LANES) board[lane].sort((a, b) => b.updated_at - a.updated_at);
  return board;
}

/** "1 needs you, 2 working, 4 finished in the last day", or a quiet line when the board is empty. */
export function boardSummary(board: Board): string {
  const parts = [
    board.attention.length > 0
      ? `${board.attention.length} need${board.attention.length === 1 ? "s" : ""} you`
      : null,
    board.working.length > 0 ? `${board.working.length} working` : null,
    board.finished.length > 0 ? `${board.finished.length} finished in the last day` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0)
    return "Nothing is running. Chats show here while they work and for a day after.";
  return `${parts.join(", ")}.`;
}

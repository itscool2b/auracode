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

/** Whether a chat's agent runs in a terminal of this window (its session shows as stopped then). */
export type InTerminal = (chatId: string) => boolean;

const nowhere: InTerminal = () => false;

export function laneOf(
  chat: ChatSummary,
  now: number,
  inTerminal: InTerminal = nowhere,
): Lane | null {
  if (
    chat.needs_attention ||
    chat.status === "auth_required" ||
    chat.status === "failed" ||
    folderStateLabel(chat.folder_state) !== null
  )
    return "attention";
  if (WORKING.has(chat.status) || inTerminal(chat.id)) return "working";
  return now - chat.updated_at <= FINISHED_WINDOW_MS ? "finished" : null;
}

/** What a card says the chat is doing, or why it needs you. */
export function stateLine(chat: ChatSummary, inTerminal: InTerminal = nowhere): string {
  if (chat.needs_attention) return "Waiting for your answer";
  if (inTerminal(chat.id)) return "In the terminal";
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

/**
 * When each chat came into its lane, so a lane keeps its order while its chats work: a streaming
 * agent touches its chat many times a second, and sorting by that would shuffle the cards. A move
 * to Finished waits in `pending` until it settles.
 */
export type Arrivals = Map<
  string,
  {
    readonly lane: Lane;
    readonly at: number;
    readonly pending?: { readonly lane: Lane; readonly since: number };
  }
>;

/**
 * How long a chat must stay finished before its card moves to Finished. An agent passes through
 * "ready" between starting and its queued prompt, and between two turns; without the wait its card
 * flickers out of Working and back. Moves to Working and Needs you are immediate.
 */
export const SETTLE_MS = 1500;

/**
 * The chats in their lanes, the latest to arrive first. A chat seen for the first time arrives at
 * its last activity, so the first board reads newest first; one that changes lane arrives `now`
 * (Finished once it has settled). `arrivals` is updated in place.
 */
export function boardOf(
  chats: readonly ChatSummary[],
  now: number,
  inTerminal: InTerminal = nowhere,
  arrivals: Arrivals = new Map(),
): Board {
  const board: Board = { attention: [], working: [], finished: [] };
  const seen = new Set<string>();
  for (const chat of chats) {
    const lane = laneOf(chat, now, inTerminal);
    if (lane === null) continue;
    seen.add(chat.id);
    const before = arrivals.get(chat.id);
    let placed: Lane = lane;
    if (before === undefined) arrivals.set(chat.id, { lane, at: chat.updated_at });
    else if (before.lane === lane) {
      if (before.pending) arrivals.set(chat.id, { lane, at: before.at });
    } else if (lane === "finished") {
      const since = before.pending?.lane === lane ? before.pending.since : now;
      if (now - since >= SETTLE_MS)
        arrivals.set(chat.id, { lane, at: Math.max(now, before.at + 1) });
      else {
        arrivals.set(chat.id, { lane: before.lane, at: before.at, pending: { lane, since } });
        placed = before.lane;
      }
    } else arrivals.set(chat.id, { lane, at: Math.max(now, before.at + 1) });
    board[placed].push(chat);
  }
  for (const id of [...arrivals.keys()]) if (!seen.has(id)) arrivals.delete(id);
  const arrived = (chat: ChatSummary) => arrivals.get(chat.id)?.at ?? chat.updated_at;
  for (const lane of LANES)
    board[lane].sort((a, b) => arrived(b) - arrived(a) || b.created_at - a.created_at);
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

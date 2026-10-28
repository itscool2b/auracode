import type { ChatCreatePreview, ChatMove, ChatSummary, WorkspaceChat } from "../bindings";
import type { WorkspaceApi } from "./workspace";

/** Where the chat options dialog moves a chat: a project, and one of its folders or none. */
export interface MoveTarget {
  readonly projectId: string;
  /** `null` keeps the chat's working folder (Rust attaches a matching folder to the project). */
  readonly folderId: string | null;
}

/** The other chats working in the destination folder. A chat is never busy with itself. */
export function busyElsewhere(
  preview: ChatCreatePreview | null,
  chatId: string,
): readonly ChatSummary[] {
  return preview?.busy_chats.filter((chat) => chat.id !== chatId) ?? [];
}

/**
 * The move request, or `null` while a busy-folder warning waits for its acknowledgment. The
 * override is sent only when the warning is showing and the person checked it; Rust rechecks.
 */
export function moveRequest(
  target: MoveTarget,
  busy: readonly ChatSummary[],
  acknowledged: boolean,
): ChatMove | null {
  if (busy.length > 0 && !acknowledged) return null;
  return {
    project_id: target.projectId,
    folder_id: target.folderId,
    allow_busy_folder: busy.length > 0 && acknowledged,
  };
}

export type MoveOutcome =
  | { readonly kind: "moved"; readonly chat: WorkspaceChat }
  | { readonly kind: "busy"; readonly busy: readonly ChatSummary[] };

/**
 * Moves a chat after checking its destination folder again: work may have started there since the
 * dialog last looked. A newly busy folder returns its chats instead of moving.
 */
export async function moveChat(
  api: Pick<WorkspaceApi, "preview" | "move">,
  chatId: string,
  target: MoveTarget,
  acknowledged: boolean,
): Promise<MoveOutcome> {
  const busy = target.folderId
    ? busyElsewhere(await api.preview(target.folderId), chatId)
    : ([] as const);
  const request = moveRequest(target, busy, acknowledged);
  if (!request) return { kind: "busy", busy };
  return { kind: "moved", chat: await api.move(chatId, request) };
}

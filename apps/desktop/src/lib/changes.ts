import {
  type ChangeDiff,
  type ChangesSnapshot,
  commands,
  type HunkRevert,
  type NativeRewind,
  type RevertPreview,
  type RevertResult,
} from "../bindings";
import { settle } from "./ipc";

export interface ChangesTransport {
  snapshot(chatId: string, turnId: string | null): Promise<ChangesSnapshot>;
  diff(chatId: string, checkpointId: string, path: string): Promise<ChangeDiff>;
  preview(chatId: string, checkpointId: string, paths: string[]): Promise<RevertPreview>;
  /** Some hunks of one modified file, counted in the text its diff gave; `revert` applies it. */
  previewHunks(chatId: string, checkpointId: string, selection: HunkRevert): Promise<RevertPreview>;
  revert(chatId: string, token: string): Promise<RevertResult>;
  /** The agent's own checkpoints (Claude's file rewind): with `dryRun`, only which files. */
  rewindFiles(chatId: string, turnId: string, dryRun: boolean): Promise<NativeRewind>;
}
export const changesApi: ChangesTransport = {
  snapshot: async (chat, turn) => settle(commands.chatChanges(chat, turn)),
  diff: async (chat, checkpoint, path) => settle(commands.chatChangeDiff(chat, checkpoint, path)),
  preview: async (chat, checkpoint, paths) =>
    settle(commands.checkpointRevertPreview(chat, checkpoint, paths)),
  previewHunks: async (chat, checkpoint, selection) =>
    settle(commands.checkpointHunkRevertPreview(chat, checkpoint, selection)),
  revert: async (chat, token) => settle(commands.checkpointRevert(chat, token)),
  rewindFiles: async (chat, turn, dryRun) => settle(commands.chatRewindFiles(chat, turn, dryRun)),
};

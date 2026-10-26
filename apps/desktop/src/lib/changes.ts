import {
  type ChangeDiff,
  type ChangesSnapshot,
  commands,
  type RevertPreview,
  type RevertResult,
} from "../bindings";
import { settle } from "./ipc";

export interface ChangesTransport {
  snapshot(chatId: string, turnId: string | null): Promise<ChangesSnapshot>;
  diff(chatId: string, checkpointId: string, path: string): Promise<ChangeDiff>;
  preview(chatId: string, checkpointId: string, paths: string[]): Promise<RevertPreview>;
  revert(chatId: string, token: string): Promise<RevertResult>;
}
export const changesApi: ChangesTransport = {
  snapshot: async (chat, turn) => settle(commands.chatChanges(chat, turn)),
  diff: async (chat, checkpoint, path) => settle(commands.chatChangeDiff(chat, checkpoint, path)),
  preview: async (chat, checkpoint, paths) =>
    settle(commands.checkpointRevertPreview(chat, checkpoint, paths)),
  revert: async (chat, token) => settle(commands.checkpointRevert(chat, token)),
};

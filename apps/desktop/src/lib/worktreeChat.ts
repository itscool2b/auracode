import {
  commands,
  type WorktreeChatInput,
  type WorktreeChatPreview,
  type WorktreeChatResult,
} from "../bindings";
import { settle } from "./ipc";
import type { TerminalTransport } from "./terminal";
import { worktreeSetupApi } from "./worktreeSetup";

/**
 * A new chat in its own worktree, in one reviewed step. Rust reviews the folder, names the branch,
 * creates the worktree, saves the chat and copies the saved setup files; nothing is decided here.
 */
export interface WorktreeChatApi {
  preview(input: WorktreeChatInput): Promise<WorktreeChatPreview>;
  apply(token: string): Promise<WorktreeChatResult>;
  /** Starts the chat's agent once a pending setup command has had its turn. */
  start(chatId: string): Promise<void>;
  /** The owned terminal that runs the reviewed setup command, started only by its Start button. */
  setupTerminal(chatId: string, token: string): TerminalTransport;
}

export const worktreeChatApi: WorktreeChatApi = {
  preview: (input) => settle(commands.worktreeChatPreview(input)),
  apply: (token) => settle(commands.worktreeChatApply(token)),
  start: async (chatId) => {
    await settle(commands.chatStart(chatId, false));
  },
  setupTerminal: (chatId, token) => worktreeSetupApi.terminal(chatId, token),
};

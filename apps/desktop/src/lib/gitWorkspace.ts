import {
  commands,
  type IsolationInput,
  type WorktreeAction,
  type WorktreeDestination,
  type WorktreeRecoveryAction,
} from "../bindings";
import { settle } from "./ipc";

/** Rust binds every mutation to a single-use preview and rechecks Git and session state. */
export const gitWorkspaceApi = {
  inspect: (chatId: string) => settle(commands.gitWorkspace(chatId)),
  list: (chatId: string) => settle(commands.managedWorktrees(chatId)),
  isolationPreview: (chatId: string, input: IsolationInput) =>
    settle(commands.isolationPreview(chatId, input)),
  isolationApply: (chatId: string, token: string) => settle(commands.isolationApply(chatId, token)),
  actionPreview: (chatId: string, worktreeId: string, action: WorktreeAction) =>
    settle(commands.worktreeActionPreview(chatId, worktreeId, action)),
  actionApply: (chatId: string, token: string) =>
    settle(commands.worktreeActionApply(chatId, token)),
  recoveryPreview: (chatId: string, worktreeId: string, action: WorktreeRecoveryAction) =>
    settle(commands.worktreeRecoveryPreview(chatId, worktreeId, action)),
  recoveryApply: (chatId: string, worktreeId: string, token: string) =>
    settle(commands.worktreeRecoveryApply(chatId, worktreeId, token)),
  relocationPreview: (chatId: string, worktreeId: string, destination: WorktreeDestination) =>
    settle(commands.worktreeRelocationPreview(chatId, worktreeId, destination)),
  relocationApply: (chatId: string, token: string) =>
    settle(commands.worktreeRelocationApply(chatId, token)),
};
export type GitWorkspaceApi = typeof gitWorkspaceApi;

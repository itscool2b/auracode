import {
  commands,
  type IsolationInput,
  type PullRequestInput,
  type WorktreeAction,
  type WorktreeDestination,
  type WorktreeRecoveryAction,
} from "../bindings";
import { settle } from "./ipc";

/** Rust binds every mutation to a single-use preview and rechecks Git and session state. */
export const gitWorkspaceApi = {
  inspect: (chatId: string) => settle(commands.gitWorkspace(chatId)),
  initializePreview: (chatId: string, branch: string) =>
    settle(commands.gitInitializePreview(chatId, branch)),
  initializeApply: (chatId: string, token: string) =>
    settle(commands.gitInitializeApply(chatId, token)),
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
  pullRequestPreview: (chatId: string, worktreeId: string, input: PullRequestInput) =>
    settle(commands.worktreePrPreview(chatId, worktreeId, input)),
  pullRequestApply: (chatId: string, token: string) =>
    settle(commands.worktreePrApply(chatId, token)),
  /** A worktree whose folder was deleted by hand comes back from its branch; commits are kept. */
  recreatePreview: (chatId: string, worktreeId: string) =>
    settle(commands.worktreeRecreatePreview(chatId, worktreeId)),
  recreateApply: (chatId: string, worktreeId: string, token: string) =>
    settle(commands.worktreeRecreateApply(chatId, worktreeId, token)),
};
export type GitWorkspaceApi = typeof gitWorkspaceApi;

/** One folder written two ways: separators and a trailing slash differ, and Windows ignores case. */
export function sameFolder(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/$/, "");
  // Windows folder names are compared without case; macOS can be case-sensitive.
  const windows = /^[a-z]:[\\/]/i.test(left);
  return windows
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right);
}

import { invoke } from "@tauri-apps/api/core";
import type {
  WorktreeSetup,
  WorktreeSetupInput,
  WorktreeSetupPreview,
  WorktreeSetupResult,
} from "../bindings";
import { terminalTransport } from "./terminal";

/** Native review and ownership checks stay in Rust. No command is constructed or run here. */
export const worktreeSetupApi = {
  read: (chatId: string) => invoke<WorktreeSetup>("worktree_setup", { chatId }),
  save: (chatId: string, input: WorktreeSetupInput) =>
    invoke<WorktreeSetup>("worktree_setup_save", { chatId, input }),
  preview: (chatId: string, worktreeId: string, commandOnly: boolean) =>
    invoke<WorktreeSetupPreview>(
      commandOnly ? "worktree_setup_command_preview" : "worktree_setup_preview",
      { chatId, worktreeId },
    ),
  apply: (chatId: string, token: string) =>
    invoke<WorktreeSetupResult>("worktree_setup_apply", { chatId, token }),
  terminal: (chatId: string, token: string) => ({
    ...terminalTransport,
    reserve: () => invoke<string>("worktree_setup_reserve", { chatId, token }),
    start: (terminalId: string, _agentId: string, size: { rows: number; cols: number }) =>
      invoke<string>("worktree_setup_start", { chatId, token, terminalId, ...size }),
  }),
};
export type WorktreeSetupApi = typeof worktreeSetupApi;

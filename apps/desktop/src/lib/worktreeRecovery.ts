import { commands } from "../bindings";
import { settle } from "./ipc";

/** Every ID resolves through the active profile's registry, including chatless saved records. */
export const worktreeRecoveryApi = {
  list: (projectId: string | null) => settle(commands.profileWorktrees(projectId)),
  preview: (id: string, action: "reconcile" | "restore") =>
    settle(commands.profileWorktreeRecoveryPreview(id, action)),
  recreate: (id: string) => settle(commands.profileWorktreeRecreatePreview(id)),
  apply: (id: string, token: string, recreate: boolean) =>
    settle(commands.profileWorktreeRecoveryApply(id, token, recreate)),
  open: async (id: string) => {
    await settle(commands.profileWorktreeOpenFolder(id));
  },
};
export type WorktreeRecoveryApi = typeof worktreeRecoveryApi;

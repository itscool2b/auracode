import { commands, type WorkspaceRemovalAction, type WorkspaceRemovalTarget } from "../bindings";
import { settle } from "./ipc";

export const workspaceRemovalApi = {
  list: () => settle(commands.workspaceRemoved()),
  review: (target: WorkspaceRemovalTarget, action: WorkspaceRemovalAction) =>
    settle(commands.workspaceRemovalPreview(target, action)),
  apply: (token: string) => settle(commands.workspaceRemovalApply(token)),
};
export type WorkspaceRemovalApi = typeof workspaceRemovalApi;

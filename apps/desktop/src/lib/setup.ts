import { setMotionPreference } from "@auracode/ui";
import { commands, type SetupAction } from "../bindings";
import { settle } from "./ipc";

export const setupApi = {
  snapshot: () => settle(commands.setupSnapshot()),
  apply: (revision: number, action: SetupAction) => settle(commands.setupApply(revision, action)),
};
export type SetupApi = typeof setupApi;
export { setMotionPreference };

import { commands, type KeepLocalPreview, type KeepLocalResult } from "../bindings";
import { settle } from "./ipc";

export interface AccountPreservationApi {
  preview(): Promise<KeepLocalPreview>;
  apply(token: string): Promise<KeepLocalResult>;
}
export const accountPreservationApi: AccountPreservationApi = {
  preview: () => settle(commands.accountKeepLocalPreview()),
  apply: (token) => settle(commands.accountKeepLocalApply(token)),
};

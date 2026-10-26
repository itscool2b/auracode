import {
  commands,
  type LocalImportPreview,
  type LocalImportResult,
  type LocalImportSelection,
} from "../bindings";
import { settle } from "./ipc";

export interface LocalImportApi {
  preview(): Promise<LocalImportPreview>;
  apply(selected: LocalImportSelection[]): Promise<LocalImportResult>;
}
export const localImportApi: LocalImportApi = {
  preview: () => settle(commands.localImportPreview()),
  apply: (selected) => settle(commands.localImportApply(selected)),
};

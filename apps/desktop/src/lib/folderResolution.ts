import {
  commands,
  type FolderLocationReview,
  type FolderResolution,
  type ProjectFolder,
} from "../bindings";
import { settle } from "./ipc";

export interface FolderResolutionApi {
  resolution(folderId: string, search: boolean): Promise<FolderResolution>;
  setRoots(roots: string[]): Promise<string[]>;
  review(folderId: string, path: string): Promise<FolderLocationReview>;
  apply(review: FolderLocationReview): Promise<ProjectFolder>;
}
export const folderResolutionApi: FolderResolutionApi = {
  resolution: (folderId, search) => settle(commands.folderResolution(folderId, search)),
  setRoots: (roots) => settle(commands.folderSetCodeRoots(roots)),
  review: (folderId, path) => settle(commands.folderLocateReview(folderId, path)),
  apply: (review) => settle(commands.folderLocateApply(review)),
};

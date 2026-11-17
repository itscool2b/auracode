/** Rust's `workspace_folder_matches` for the development fixtures. No native call runs. */
import type { FolderMatches, WorkspaceSnapshot } from "../bindings";
import { sameFolder } from "../lib/gitWorkspace";

/**
 * The project folders a picked path names in `snapshot`, compared as `sameFolder` compares them
 * (Rust canonicalises instead), the one with the latest chat first; a folder Rust marked as a
 * worktree answers as one.
 */
export function fixtureFolderMatches(
  snapshot: () => WorkspaceSnapshot | Promise<WorkspaceSnapshot>,
): (path: string) => Promise<FolderMatches> {
  return async (path) => {
    const data = await snapshot();
    const folders = data.projects.flatMap((project) =>
      project.folders
        .filter((folder) => folder.path !== null && sameFolder(folder.path, path))
        .map((folder) => ({ folder, project })),
    );
    const tree = folders.find(({ folder }) => folder.worktree_of);
    const latest = (folderId: string) =>
      data.chats
        .filter((entry) => entry.folder_id === folderId)
        .reduce<number | null>(
          (most, entry) =>
            most === null ? entry.chat.updated_at : Math.max(most, entry.chat.updated_at),
          null,
        );
    return {
      path,
      matches: folders
        .map(({ folder, project }) => ({
          folder_id: folder.id,
          project_id: project.id,
          project_name: project.name,
          last_chat_at: latest(folder.id),
        }))
        .toSorted((a, b) => (b.last_chat_at ?? -1) - (a.last_chat_at ?? -1)),
      worktree: tree?.folder.worktree_of
        ? { branch: tree.folder.display_name, source: tree.folder.worktree_of }
        : null,
    };
  };
}

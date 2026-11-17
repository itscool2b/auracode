import type {
  AgentEntry,
  ManagedWorktree,
  ProjectSummary,
  WorkspaceSnapshot,
} from "../../bindings";
import { sameFolder } from "../gitWorkspace";
import { preselectAgent } from "../setup";

export interface NewChatContext {
  readonly projectId: string;
  readonly projectName: string;
  readonly folderId: string | null;
  readonly defaultAgent: string | null;
}

/** Resolve only this project's usable mappings; never borrow a folder from another project. */
export function projectChatContext(
  project: ProjectSummary,
  workspace: WorkspaceSnapshot,
): NewChatContext {
  const usable = project.folders.filter((folder) => folder.path && folder.folder_state === "ok");
  const recent = workspace.chats
    .filter((entry) => entry.project_id === project.id && !entry.archived)
    .toSorted((a, b) => b.chat.updated_at - a.chat.updated_at)
    .find((entry) => usable.some((folder) => folder.id === entry.folder_id));
  return {
    projectId: project.id,
    projectName: project.name,
    folderId: usable.length === 1 ? (usable[0]?.id ?? null) : (recent?.folder_id ?? null),
    defaultAgent: project.default_agent,
  };
}

/** Re-resolve automatic prefill once retained worktrees identify the actual project sources. */
export function projectSourceFolder(
  context: NewChatContext | null,
  workspace: WorkspaceSnapshot | null,
  retained: readonly Pick<ManagedWorktree, "path" | "source">[],
): string | null {
  const project = workspace?.projects.find((project) => project.id === context?.projectId);
  if (!context || !project) return null;
  const eligible = project.folders.filter(
    (folder) =>
      folder.path &&
      folder.folder_state === "ok" &&
      !retained.some((record) => sameFolder(record.path, folder.path as string)),
  );
  const selected = project.folders.find((folder) => folder.id === context.folderId);
  if (eligible.some((folder) => folder.id === selected?.id)) return selected?.id ?? null;
  const worktree = selected?.path
    ? retained.find((record) => sameFolder(record.path, selected.path as string))
    : undefined;
  const source = worktree
    ? eligible.find((folder) => sameFolder(folder.path as string, worktree.source))
    : undefined;
  return source?.id ?? (eligible.length === 1 ? (eligible[0]?.id ?? null) : null);
}

/** What the chats screen shows: a chat, or New chat with its draft. */
export interface ChatsView<Draft> {
  readonly selected: string | null;
  readonly composing: boolean;
  readonly draft: Draft;
}

/**
 * Whether a chat New chat finished creating opens: only while the draft that made it still shows.
 * Creating takes a while (a worktree, its setup), and the person may have moved on meanwhile.
 */
export function createdChatOpens<Draft>(view: ChatsView<Draft>, creator: Draft): boolean {
  return view.selected === null && view.composing && view.draft === creator;
}

/** Project preference leads; an unavailable default falls back to the profile preference. */
export function newChatAgent(
  context: NewChatContext | null,
  profileDefault: string | null,
  agents: readonly AgentEntry[] | null,
  chosen: string | null,
): string | "wait" | null {
  if (chosen !== null) return null;
  const preferred = preselectAgent(context?.defaultAgent ?? null, agents, chosen);
  return preferred ?? preselectAgent(profileDefault, agents, chosen);
}

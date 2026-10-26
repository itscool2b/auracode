/** Synthetic Git review fixture. It never invokes native commands or touches a repository. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GitWorkspace, ManagedWorktree, WorktreeActionPreview } from "../bindings";
import { GitDialog } from "../components/chat/GitDialog";
import type { GitWorkspaceApi } from "../lib/gitWorkspace";

const params = new URLSearchParams(location.search);
const calls: string[] = [];
const workspace: GitWorkspace = {
  root: "C:/projects/orbit",
  branch: "main",
  head: "5a4d64755cbb57ee734ad9502760eb225274491a",
  files: [],
  blockers: [],
  has_submodules: false,
  is_linked_worktree: false,
};
let worktrees: ManagedWorktree[] = [];
let preview: WorktreeActionPreview | null = null;
let sequence = 0;
let currentFolder = workspace.root;
let relocationTarget = "";
const makeWorktree = (): ManagedWorktree => ({
  id: "worktree-one",
  chat_id: "chat",
  source: workspace.root,
  path: "C:/auracode/worktrees/owned-one",
  branch: "aura/release-readiness",
  base_commit: workspace.head ?? "",
  state: "ready",
  detail: null,
  recovery: null,
  created_at: 1,
});
const api: GitWorkspaceApi = {
  inspect: async () => ({ ...structuredClone(workspace), root: currentFolder }),
  list: async () => structuredClone(worktrees),
  isolationPreview: async (_chat, input) => {
    calls.push("review-isolation");
    return {
      token: `isolation-${++sequence}`,
      source: structuredClone(workspace),
      branch: `aura/${input.slug}`,
      path: "C:/auracode/worktrees/owned-one",
      bring_changes: input.bring_changes,
      warnings: ["Uncommitted changes stay in the source folder."],
      expires_at: Date.now() + 600_000,
    };
  },
  isolationApply: async () => {
    calls.push("apply-isolation");
    const worktree = makeWorktree();
    worktrees = [worktree];
    return { worktree, warning: null };
  },
  actionPreview: async (_chat, _id, action) => {
    calls.push(`review-${action.type}`);
    preview = {
      token: `action-${++sequence}`,
      worktree: structuredClone(worktrees[0] ?? makeWorktree()),
      action,
      target: action.type === "merge" ? structuredClone(workspace) : null,
      changes:
        action.type === "merge"
          ? "src/orbit.rs | 18 +++++++++++++-----\n1 file changed, 13 insertions(+), 5 deletions(-)"
          : "All working files stay in a retained directory.",
      conflicts:
        action.type === "merge" && sessionStorage.getItem("git-conflict") ? ["src/orbit.rs"] : [],
      warnings: [
        action.type === "merge"
          ? "The reviewed target branch and files will change."
          : "The branch, ignored files and uncommitted work are retained.",
      ],
      expires_at: Date.now() + 600_000,
    };
    return structuredClone(preview);
  },
  actionApply: async () => {
    calls.push("apply-action");
    if (sessionStorage.getItem("git-stale"))
      throw new Error("The repository changed after this review. Review it again before applying.");
    const tree = worktrees[0] ?? makeWorktree();
    const worktree =
      preview?.action.type === "discard"
        ? { ...tree, state: "retired" as const, path: "C:/auracode/retained/owned-one" }
        : tree;
    worktrees = [worktree];
    return {
      worktree,
      recovery: "The branch and recovery refs remain available.",
      commit: preview?.action.type === "merge" ? workspace.head : null,
      error: null,
    };
  },
  recoveryPreview: async (_chat, _id, action) => {
    calls.push(`review-${action}`);
    return {
      token: `recovery-${++sequence}`,
      worktree: structuredClone(worktrees[0] ?? makeWorktree()),
      action,
      folder: { ...workspace, root: "C:/auracode/retained/owned-one" },
      target: null,
      destination: "C:/auracode/worktrees/owned-one",
      warnings: ["Restore keeps the retained files and branch."],
      expires_at: Date.now() + 600_000,
    };
  },
  recoveryApply: async () => {
    calls.push("apply-recovery");
    const worktree = makeWorktree();
    worktrees = [worktree];
    return {
      worktree,
      recovery: "The retained worktree is available again.",
      commit: null,
      error: null,
    };
  },
  relocationPreview: async (_chat, _id, destination) => {
    calls.push(`review-move-${destination}`);
    const tree = worktrees[0] ?? makeWorktree();
    relocationTarget = destination === "isolated" ? tree.path : tree.source;
    return {
      token: `relocation-${++sequence}`,
      worktree: structuredClone(tree),
      from: currentFolder,
      to: relocationTarget,
      handoff:
        "Continue release readiness in the reviewed folder. Keep the existing changes and inspect the destination before editing.",
      warnings: ["The next prompt starts a new native session with this visible context."],
      expires_at: Date.now() + 600_000,
    };
  },
  relocationApply: async () => {
    calls.push("apply-relocation");
    if (sessionStorage.getItem("git-stale"))
      throw new Error("The repository changed after this review. Review it again before applying.");
    currentFolder = relocationTarget;
    return { chat_id: "chat", prompt: null };
  },
};
Object.assign(window, { gitFixture: { calls: () => [...calls] } });
function Preview() {
  const [live, setLive] = useState(params.has("live"));
  const [open, setOpen] = useState(true);
  return (
    <main
      className="orbit-theme"
      data-theme="dark"
      style={{ height: "100%", background: "var(--o-tray)" }}
    >
      <h1 className="settings-sr-only">Git fixture workspace</h1>
      {open ? (
        <GitDialog
          chatId="chat"
          title="Release readiness"
          api={api}
          live={live}
          allowIsolation
          onStop={async () => {
            calls.push("stop");
            setLive(false);
          }}
          onChanged={() => {
            calls.push("refresh-chat");
          }}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Open Git workspace
        </button>
      )}
    </main>
  );
}
export function mountGitPreview(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}

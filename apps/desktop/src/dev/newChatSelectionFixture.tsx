/** Synthetic delayed-retention services for check-new-chat-selection.mjs. No native calls run. */
import { createRoot } from "react-dom/client";
import type { AgentEntry, ManagedWorktree, ProjectFolder } from "../bindings";
import { NewChat } from "../components/chat/NewChat";
import { NewChatDraft } from "../lib/chat/appStore";
import { projectChatContext } from "../lib/chat/newChatContext";
import { chatSummary, FakeTransport } from "../lib/chat/testing";
import { WorkspaceStore } from "../lib/workspace";
import { worktreeRecoveryApi } from "../lib/worktreeRecovery";
import { FIXTURE_FOLDER, newChatFixture } from "./newChatWorktreeFixture";

export async function mountNewChatSelectionFixture(container: HTMLElement) {
  const base = newChatFixture("plain");
  const snapshot = await base.workspace.api.snapshot();
  const project = snapshot.projects[0];
  const source = project?.folders[0];
  if (!project || !source) throw new Error("Missing synthetic project");
  const managed: ProjectFolder = {
    ...source,
    id: "folder-managed",
    path: "/workspace/retained",
    display_name: "Retained worktree",
  };
  const alternate: ProjectFolder = {
    ...source,
    id: "folder-alternate",
    path: "/workspace/alternate",
    display_name: "Other source",
  };
  const data = {
    projects: [{ ...project, folders: [source, managed, alternate] }],
    chats: [
      {
        chat: { ...chatSummary("recent"), folder: managed.path as string, updated_at: 100 },
        project_id: project.id,
        folder_id: managed.id,
        pinned: false,
        archived: false,
      },
    ],
  };
  const records: ManagedWorktree[] = [
    {
      id: "managed",
      chat_id: "recent",
      path: managed.path as string,
      source: FIXTURE_FOLDER,
      state: "ready",
      branch: "aura/retained",
      base_commit: "1234",
      created_at: 1,
      detail: null,
    },
  ];
  let release = () => {};
  const retained = new Promise<ManagedWorktree[]>((resolve) => {
    release = () => resolve(records);
  });
  const workspace = new WorkspaceStore({
    ...base.workspace.api,
    snapshot: async () => structuredClone(data),
    preview: async (id) => {
      const folder = data.projects[0]?.folders.find((folder) => folder.id === id);
      if (!folder) throw new Error("Unknown synthetic folder");
      return { folder, busy_chats: [] };
    },
  });
  await workspace.refresh();
  const draft = new NewChatDraft(
    new FakeTransport({ pickFolder: async () => alternate.path }),
    projectChatContext(data.projects[0] as typeof project, data),
  );
  const agent: AgentEntry = {
    id: "claude",
    name: "Claude Code",
    description: "Synthetic installed agent",
    availability: { state: "ready", path: "/fixture/claude", version: null },
    launch: "claude",
    needs_download: false,
    last_verified: "",
    installation: null,
    latest_release: null,
  };
  draft.chooseAgent(agent.id);
  const root = createRoot(container);
  root.render(
    <NewChat
      agents={[agent]}
      refreshing={false}
      draft={draft}
      onRefreshAgents={() => {}}
      onCreated={() => {}}
      workspace={workspace}
      worktreeApi={base.api}
      recoveryApi={{ ...worktreeRecoveryApi, list: () => retained }}
    />,
  );
  return {
    releaseRetained: release,
    refresh: () => workspace.refresh(),
    unmount: () => root.unmount(),
  };
}

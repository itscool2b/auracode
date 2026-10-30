/** Development-only Chat options fixture. No native command, folder check or agent process. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ChatMove,
  ProjectFolder,
  ProjectSummary,
  WorkspaceChat,
  WorkspaceSnapshot,
} from "../bindings";
import { ChatActionsDialog } from "../components/chat/ChatActionsDialog";
import { chatSummary, FakeTransport } from "../lib/chat/testing";
import { type WorkspaceApi, WorkspaceStore } from "../lib/workspace";

const folder = (id: string, projectId: string, name: string, path: string): ProjectFolder => ({
  id,
  project_id: projectId,
  display_name: name,
  path,
  folder_state: "ok",
  unavailable_reason: null,
  kind: "local",
  git_remote_url: null,
  git_default_branch: null,
});
const project = (id: string, name: string, folders: ProjectFolder[]): ProjectSummary => ({
  id,
  name,
  color: null,
  default_agent: null,
  default_model: null,
  folders,
  created_at: 1,
  updated_at: 1,
});
const site = folder("folder-site", "project-site", "site", "C:/code/auracode-site");
const moving = chatSummary("chat-moving", {
  title: "Tidy the release notes",
  folder: "C:/code/auracode",
  status: "stopped",
});
const working = chatSummary("chat-working", {
  title: "Rebuild the pricing page",
  agent_name: "Codex",
  folder: "C:/code/auracode-site",
  status: "running",
});
const entry = (chat: typeof moving, projectId: string, folderId: string): WorkspaceChat => ({
  chat,
  project_id: projectId,
  folder_id: folderId,
  pinned: false,
  archived: false,
});
const snapshot: WorkspaceSnapshot = {
  projects: [
    project("project-app", "auracode", [
      folder("folder-app", "project-app", "auracode", "C:/code/auracode"),
    ]),
    project("project-site", "Website", [site]),
  ],
  chats: [
    entry(moving, "project-app", "folder-app"),
    entry(working, "project-site", "folder-site"),
  ],
};
const calls: ChatMove[] = [];
const fail = async (): Promise<never> => {
  throw new Error("The fixture does not change this.");
};
const api: WorkspaceApi = {
  snapshot: async () => structuredClone(snapshot),
  createProject: fail,
  updateProject: fail,
  addFolder: fail,
  rename: fail,
  pin: fail,
  archive: fail,
  move: async (_id, request) => {
    calls.push(request);
    return entry(moving, request.project_id, request.folder_id ?? "folder-app");
  },
  // The site folder has a running chat; any other folder is quiet.
  preview: async (folderId) => ({
    folder: site,
    busy_chats: folderId === site.id ? [working] : [],
  }),
  createChat: fail,
};
Object.assign(window, { chatOptionsFixture: { moves: () => [...calls] } });

function Preview() {
  const [store] = useState(() => {
    const value = new WorkspaceStore(api);
    void value.refresh();
    return value;
  });
  const [open, setOpen] = useState(true);
  return (
    <main className="chat-app">
      <h1 className="sr-only">Chat options</h1>
      {open ? (
        <ChatActionsDialog
          entry={entry(moving, "project-app", "folder-app")}
          chat={moving}
          store={store}
          transport={new FakeTransport()}
          onChanged={() => {}}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  );
}

export function mountChatOptionsPreview(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}

import {
  type ChatMove,
  commands,
  type ProjectChatCreate,
  type ProjectCreate,
  type ProjectInput,
  type WorkspaceSnapshot,
} from "../bindings";
import { errorMessage } from "./errors";
import { settle } from "./ipc";

/** Presentation transport only. Rust owns validation, persistence and session/folder safeguards. */
export const workspaceApi = {
  snapshot: () => settle(commands.workspaceSnapshot({ include_archived: true, project_id: null })),
  createProject: (request: ProjectCreate) => settle(commands.projectCreate(request)),
  updateProject: (id: string, input: ProjectInput) => settle(commands.projectUpdate(id, input)),
  addFolder: (id: string, path: string) => settle(commands.projectAddFolder(id, path)),
  rename: (id: string, title: string) => settle(commands.chatRename(id, title)),
  pin: (id: string, pinned: boolean) => settle(commands.chatPin(id, pinned)),
  archive: (id: string, archived: boolean) => settle(commands.chatArchive(id, archived)),
  move: (id: string, request: ChatMove) => settle(commands.chatMove(id, request)),
  preview: (folderId: string) => settle(commands.chatCreatePreview(folderId)),
  createChat: (request: ProjectChatCreate) => settle(commands.chatProjectCreate(request)),
};
export type WorkspaceApi = typeof workspaceApi;
export interface WorkspaceView {
  readonly data: WorkspaceSnapshot | null;
  readonly error: string | null;
  readonly busy: boolean;
}
export const EMPTY_WORKSPACE: WorkspaceView = { data: null, error: null, busy: false };

export class WorkspaceStore {
  readonly api: WorkspaceApi;
  #state: WorkspaceView = EMPTY_WORKSPACE;
  #listeners = new Set<() => void>();
  #revision = 0;
  constructor(api: WorkspaceApi) {
    this.api = api;
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.#state;
  #publish(state: WorkspaceView) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
  async refresh(): Promise<void> {
    const revision = ++this.#revision;
    try {
      const data = await this.api.snapshot();
      if (revision === this.#revision) this.#publish({ ...this.#state, data, error: null });
    } catch (error) {
      if (revision === this.#revision)
        this.#publish({ ...this.#state, error: errorMessage(error) });
    }
  }
  async perform<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.#state.busy) return null;
    this.#publish({ ...this.#state, busy: true, error: null });
    try {
      const result = await operation();
      await this.refresh();
      return result;
    } catch (error) {
      this.#publish({ ...this.#state, error: errorMessage(error) });
      return null;
    } finally {
      this.#publish({ ...this.#state, busy: false });
    }
  }
}

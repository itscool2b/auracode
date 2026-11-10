/** Browser fixture only. All values are synthetic and stay in this page's memory. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MemoryRevision, ProjectMemory, ProjectMemoryChanged } from "../bindings";
import { Banners } from "../components/chat/Banners";
import { ProjectMemoryPanel } from "../components/settings/ProjectMemoryPanel";
import {
  agentEditText,
  agentEditToast,
  type MemoryChats,
  type ProjectMemoryApi,
  useAgentMemoryEdits,
} from "../lib/projectMemory";
import { createSetupFixture } from "./setupFixture";

export interface ProjectMemoryFixture {
  readonly api: ProjectMemoryApi;
  /**
   * An agent's write through its chat's grant. It is saved while agents may edit memory and
   * refused otherwise; the answer says which. `silent` skips the change event, as a missed event
   * would.
   */
  agentWrite(
    markdown: string,
    options?: { readonly silent?: boolean; readonly chat?: string },
  ): boolean;
  /** What was saved, newest first, with who saved it and why. */
  saves(): readonly Pick<MemoryRevision, "markdown" | "reason" | "source">[];
}

const FIRST = "fixture-project";

export function createProjectMemoryFixture(
  agentsEdit: () => boolean = () => true,
): ProjectMemoryFixture {
  const memories = new Map<string, ProjectMemory>([
    [
      FIRST,
      {
        project_id: FIRST,
        revision: "revision-one",
        markdown: "# Project notes\n\nUse pnpm for workspace commands.\n",
        updated_at: 1793505600000,
      },
    ],
    [
      "second-project",
      { project_id: "second-project", revision: null, markdown: "", updated_at: 1793505600000 },
    ],
  ]);
  const history: MemoryRevision[] = [
    {
      revision: "revision-one",
      parent_revision: null,
      project_id: FIRST,
      markdown: "# Project notes\n\nUse pnpm for workspace commands.\n",
      reason: "Initial project notes",
      source: "user",
      created_at: 1793505600000,
    },
  ];
  const listeners = new Set<(change: ProjectMemoryChanged) => void>();
  const notify = (change: ProjectMemoryChanged) => {
    for (const listener of [...listeners]) listener(change);
  };
  const copy = <T,>(value: T): T => structuredClone(value);
  const of = (id: string): ProjectMemory => {
    const memory = memories.get(id);
    if (!memory) throw new Error("That project is no longer here.");
    return memory;
  };
  // `?case=stale`: the first save meets a version saved on another device a moment earlier.
  let raced = new URLSearchParams(location.search).get("case") === "stale";
  function commit(id: string, markdown: string, reason: string, source: string): MemoryRevision {
    const memory = of(id);
    const next: MemoryRevision = {
      revision: `revision-${history.length + 1}`,
      parent_revision: memory.revision,
      project_id: id,
      markdown,
      reason,
      source,
      created_at: memory.updated_at + 60_000,
    };
    history.unshift(next);
    memories.set(id, {
      project_id: id,
      revision: next.revision,
      markdown,
      updated_at: next.created_at,
    });
    return next;
  }
  const api: ProjectMemoryApi = {
    read: async (id) => copy(of(id)),
    history: async (id) => copy(history.filter((revision) => revision.project_id === id)),
    save: async (input) => {
      if (raced) {
        raced = false;
        commit(input.project_id, "Saved on another device.\n", "Edited elsewhere", "user");
      }
      if (input.expected_revision !== of(input.project_id).revision)
        throw new Error("Project memory changed while you were editing.");
      commit(input.project_id, input.markdown, input.reason, "user");
      notify({ project_id: input.project_id, agent_edit: null });
      return copy(of(input.project_id));
    },
    subscribe: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
  return {
    api,
    saves: () => history.map(({ markdown, reason, source }) => ({ markdown, reason, source })),
    agentWrite(markdown, { silent = false, chat = "chat-fixture" } = {}) {
      if (!agentsEdit()) return false;
      const parent = of(FIRST).revision;
      const next = commit(FIRST, markdown, "Learned while working", `agent:${chat}`);
      if (!silent)
        notify({
          project_id: FIRST,
          agent_edit: { revision: next.revision, parent_revision: parent, chat_id: chat },
        });
      return true;
    },
  };
}

const ONE = [{ id: FIRST, name: "auracode fixture" }];
const TWO = [...ONE, { id: "second-project", name: "website fixture" }];
const CHATS: MemoryChats = new Map([
  ["chat-fixture", { title: "Fix the login flow", agent: "Claude Code" }],
  ["chat-untitled", { title: null, agent: "Codex" }],
]);
const setup = createSetupFixture();
const fixture = createProjectMemoryFixture(() => setup.general().agent_memory_writes);

export default function ProjectMemoryPreview() {
  const edits = useAgentMemoryEdits(fixture.api);
  // Open shows the panel afresh, as Settings does in the app.
  const [opened, setOpened] = useState(0);
  const params = new URLSearchParams(location.search);
  const projects = params.get("projects") === "2" ? TWO : params.get("projects") === "0" ? [] : ONE;
  return (
    <main
      className="g-root settings-content"
      style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}
    >
      <h1>Customize</h1>
      <Banners
        storage={null}
        memoryEdits={edits.notices.map((notice) => ({
          key: `${notice.projectId}:${notice.revision}`,
          ...agentEditToast(notice, CHATS, "auracode fixture"),
          text: agentEditText(notice, CHATS, "auracode fixture"),
          state: notice.state,
          onReview: () => {
            edits.dismiss(notice);
            setOpened(Date.now());
          },
          onUndo: () => void edits.undo(notice, CHATS),
          onDismiss: () => edits.dismiss(notice),
        }))}
      />
      <ProjectMemoryPanel key={opened} projects={projects} api={fixture.api} setup={setup} />
    </main>
  );
}
export function mountProjectMemoryPreview(container: HTMLElement) {
  Object.assign(window, {
    projectMemoryFixture: { agentWrite: fixture.agentWrite, saves: fixture.saves },
  });
  createRoot(container).render(
    <StrictMode>
      <ProjectMemoryPreview />
    </StrictMode>,
  );
}

/** Browser fixture only. All values are synthetic and stay in this page's memory. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  MemoryProposal,
  MemoryRevision,
  ProjectMemory,
  ProjectMemoryChanged,
} from "../bindings";
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
   * An agent's write through its chat's grant: a revision while direct edits are on, otherwise a
   * proposal. `silent` skips the change event, as a missed event would.
   */
  agentWrite(
    markdown: string,
    options?: { readonly silent?: boolean; readonly chat?: string },
  ): void;
}

export function createProjectMemoryFixture(
  direct: () => boolean = () => true,
): ProjectMemoryFixture {
  let memory: ProjectMemory = {
    project_id: "fixture-project",
    revision: "revision-one",
    markdown: "# Project notes\n\nUse pnpm for workspace commands.\n",
    updated_at: 1793505600000,
  };
  const history: MemoryRevision[] = [
    {
      revision: "revision-one",
      parent_revision: null,
      project_id: memory.project_id,
      markdown: memory.markdown,
      reason: "Initial reviewed project notes",
      source: "user",
      created_at: memory.updated_at,
    },
  ];
  const proposals: MemoryProposal[] = [
    {
      id: "proposal-current",
      project_id: memory.project_id,
      base_revision: memory.revision,
      markdown: `${memory.markdown}\nRun affected Rust tests before committing.\n`,
      reason: "Remember the Rust verification command",
      chat_id: "chat-fixture",
      idempotency_key: "current",
      state: "pending",
      created_at: memory.updated_at + 1,
    },
    {
      id: "proposal-stale",
      project_id: memory.project_id,
      base_revision: "older-revision",
      markdown: "# Conflicting notes\n\nAn earlier device changed these notes.\n",
      reason: "A conflicting edit from another device",
      chat_id: null,
      idempotency_key: "stale",
      state: "conflict",
      created_at: memory.updated_at + 2,
    },
  ];
  const listeners = new Set<(change: ProjectMemoryChanged) => void>();
  const notify = (change: ProjectMemoryChanged) => {
    for (const listener of [...listeners]) listener(change);
  };
  const copy = <T,>(value: T): T => structuredClone(value);
  let concurrentEdit = new URLSearchParams(location.search).get("case") === "stale";
  function commit(markdown: string, reason: string, source: string): MemoryRevision {
    const next: MemoryRevision = {
      revision: `revision-${history.length + 1}`,
      parent_revision: memory.revision,
      project_id: memory.project_id,
      markdown,
      reason,
      source,
      created_at: memory.updated_at + 60_000,
    };
    history.unshift(next);
    memory = {
      project_id: memory.project_id,
      revision: next.revision,
      markdown: next.markdown,
      updated_at: next.created_at,
    };
    return next;
  }
  async function save(input: {
    expected_revision: string | null;
    markdown: string;
    reason: string;
  }) {
    if (concurrentEdit) {
      concurrentEdit = false;
      memory = { ...memory, revision: "another-device", markdown: "Saved on another device." };
      throw new Error("Project memory changed. Review the current revision before saving.");
    }
    if (input.expected_revision !== memory.revision)
      throw new Error("Project memory changed. Review the current revision before saving.");
    commit(input.markdown, input.reason, "user");
    notify({ project_id: memory.project_id, agent_edit: null });
    return copy(memory);
  }
  const api: ProjectMemoryApi = {
    read: async () => copy(memory),
    history: async () => copy(history),
    proposals: async () => copy(proposals),
    save,
    accept: async (input) => {
      const proposal = proposals.find((p) => p.id === input.proposal_id);
      if (!proposal || proposal.base_revision !== input.expected_revision)
        throw new Error("This proposal is stale.");
      const result = await save({ ...input, markdown: proposal.markdown, reason: proposal.reason });
      proposal.state = "accepted";
      return result;
    },
    reject: async (_id, id) => {
      const proposal = proposals.find((p) => p.id === id);
      if (proposal) proposal.state = "rejected";
      notify({ project_id: memory.project_id, agent_edit: null });
      return copy(proposals);
    },
    export: async () =>
      copy({
        schema_version: 1,
        project_id: memory.project_id,
        current: memory,
        history,
        proposals,
      }),
    import: async (input) =>
      save({
        expected_revision: input.expected_revision,
        markdown: input.bundle.current.markdown,
        reason: "Imported reviewed Markdown",
      }),
    subscribe: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
  return {
    api,
    agentWrite(markdown, { silent = false, chat = "chat-fixture" } = {}) {
      if (!direct()) {
        proposals.unshift({
          id: `proposal-${proposals.length + 1}`,
          project_id: memory.project_id,
          base_revision: memory.revision,
          markdown,
          reason: "Learned while working",
          chat_id: chat,
          idempotency_key: `fixture-${proposals.length + 1}`,
          state: "pending",
          created_at: memory.updated_at + 1,
        });
        if (!silent) notify({ project_id: memory.project_id, agent_edit: null });
        return;
      }
      const parent = memory.revision;
      const next = commit(markdown, "Learned while working", `agent:${chat}`);
      if (!silent)
        notify({
          project_id: memory.project_id,
          agent_edit: { revision: next.revision, parent_revision: parent, chat_id: chat },
        });
    },
  };
}

const PROJECTS = [{ id: "fixture-project", name: "auracode fixture" }];
const CHATS: MemoryChats = new Map([
  ["chat-fixture", { title: "Fix the login flow", agent: "Claude Code" }],
  ["chat-untitled", { title: null, agent: "Codex" }],
]);
const setup = createSetupFixture();
const fixture = createProjectMemoryFixture(() => setup.general().agent_memory_writes);

export default function ProjectMemoryPreview() {
  const edits = useAgentMemoryEdits(fixture.api);
  // Review opens the panel afresh on the edit, as Customize does in the app.
  const [entry, setEntry] = useState<{ readonly key: number; readonly revision?: string }>({
    key: 0,
  });
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
            setEntry({ key: Date.now(), revision: notice.revision });
          },
          onUndo: () => void edits.undo(notice, CHATS),
          onDismiss: () => edits.dismiss(notice),
        }))}
      />
      <ProjectMemoryPanel
        key={entry.key}
        projects={PROJECTS}
        api={fixture.api}
        setup={setup}
        chats={CHATS}
        initialRevision={entry.revision}
      />
    </main>
  );
}
export function mountProjectMemoryPreview(container: HTMLElement) {
  Object.assign(window, { projectMemoryFixture: { agentWrite: fixture.agentWrite } });
  createRoot(container).render(
    <StrictMode>
      <ProjectMemoryPreview />
    </StrictMode>,
  );
}

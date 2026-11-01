/** Browser fixture only. All values are synthetic and stay in this page's memory. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { MemoryProposal, MemoryRevision, ProjectMemory } from "../bindings";
import { ProjectMemoryPanel } from "../components/settings/ProjectMemoryPanel";
import type { ProjectMemoryApi } from "../lib/projectMemory";

export function createProjectMemoryFixture(): ProjectMemoryApi {
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
  const copy = <T,>(value: T): T => structuredClone(value);
  let concurrentEdit = new URLSearchParams(location.search).get("case") === "stale";
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
    const next: MemoryRevision = {
      revision: `revision-${history.length + 1}`,
      parent_revision: memory.revision,
      project_id: memory.project_id,
      markdown: input.markdown,
      reason: input.reason,
      source: "user",
      created_at: memory.updated_at + 1000,
    };
    history.unshift(next);
    memory = {
      project_id: memory.project_id,
      revision: next.revision,
      markdown: next.markdown,
      updated_at: next.created_at,
    };
    return copy(memory);
  }
  return {
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
  };
}
const api = createProjectMemoryFixture();
export default function ProjectMemoryPreview() {
  return (
    <main
      className="g-root settings-content"
      style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}
    >
      <h1>Customize</h1>
      <ProjectMemoryPanel
        projects={[{ id: "fixture-project", name: "auracode fixture" }]}
        api={api}
      />
    </main>
  );
}
export function mountProjectMemoryPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <ProjectMemoryPreview />
    </StrictMode>,
  );
}

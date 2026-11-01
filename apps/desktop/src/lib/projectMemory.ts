import {
  type AcceptMemoryProposal,
  commands,
  type ImportProjectMemory,
  type MemoryProposal,
  type MemoryRevision,
  type ProjectMemory,
  type ProjectMemoryBundle,
  type SaveProjectMemory,
} from "../bindings";
import { settle } from "./ipc";

export interface ProjectMemoryApi {
  read(projectId: string): Promise<ProjectMemory>;
  save(input: SaveProjectMemory): Promise<ProjectMemory>;
  accept(input: AcceptMemoryProposal): Promise<ProjectMemory>;
  reject(projectId: string, proposalId: string): Promise<MemoryProposal[]>;
  history(projectId: string): Promise<MemoryRevision[]>;
  proposals(projectId: string): Promise<MemoryProposal[]>;
  export(projectId: string): Promise<ProjectMemoryBundle>;
  import(input: ImportProjectMemory): Promise<ProjectMemory>;
}
export const projectMemoryApi: ProjectMemoryApi = {
  read: (id) => settle(commands.readProjectMemory(id)),
  save: (input) => settle(commands.saveProjectMemory(input)),
  accept: (input) => settle(commands.acceptMemoryProposal(input)),
  reject: (id, proposal) => settle(commands.rejectMemoryProposal(id, proposal)),
  history: (id) => settle(commands.projectMemoryHistory(id)),
  proposals: (id) => settle(commands.projectMemoryProposals(id)),
  export: (id) => settle(commands.exportProjectMemory(id)),
  import: (input) => settle(commands.importProjectMemory(input)),
};
export const MAX_MEMORY_BYTES = 16 * 1024;
export function memoryBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}
export function proposalIsCurrent(proposal: MemoryProposal, memory: ProjectMemory): boolean {
  return (
    proposal.project_id === memory.project_id &&
    proposal.base_revision === memory.revision &&
    (proposal.state === "pending" || proposal.state === "conflict")
  );
}

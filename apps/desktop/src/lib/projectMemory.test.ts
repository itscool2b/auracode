import { describe, expect, it } from "vitest";
import type { MemoryProposal, ProjectMemory } from "../bindings";
import { MAX_MEMORY_BYTES, memoryBytes, proposalIsCurrent } from "./projectMemory";

const memory: ProjectMemory = {
  project_id: "one",
  revision: "r2",
  markdown: "Current",
  updated_at: 1,
};
const proposal: MemoryProposal = {
  id: "p",
  project_id: "one",
  base_revision: "r2",
  markdown: "Proposed",
  reason: "Learned fact",
  chat_id: "chat",
  idempotency_key: "key",
  state: "pending",
  created_at: 1,
};
describe("project memory review", () => {
  it("counts UTF-8 bytes without silently truncating Markdown", () => {
    expect(memoryBytes("é")).toBe(2);
    expect(memoryBytes("é".repeat(MAX_MEMORY_BYTES / 2))).toBe(MAX_MEMORY_BYTES);
    expect(memoryBytes("é".repeat(MAX_MEMORY_BYTES / 2 + 1))).toBeGreaterThan(MAX_MEMORY_BYTES);
  });
  it("only enables exact current-base pending proposals from the same project", () => {
    expect(proposalIsCurrent(proposal, memory)).toBe(true);
    expect(proposalIsCurrent({ ...proposal, base_revision: "r1" }, memory)).toBe(false);
    expect(proposalIsCurrent({ ...proposal, project_id: "two" }, memory)).toBe(false);
    expect(proposalIsCurrent({ ...proposal, state: "accepted" }, memory)).toBe(false);
    expect(proposalIsCurrent({ ...proposal, state: "conflict" }, memory)).toBe(true);
  });
});

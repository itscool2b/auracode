import { describe, expect, it } from "vitest";
import type { InstructionsAgent } from "../bindings";
import { createInstructionsFixture } from "../dev/instructionsFixture";
import {
  editableFiles,
  fileByKey,
  listNames,
  modeSentence,
  parseTargetKey,
  readersSentence,
  statusWord,
  targetKey,
  worktreeGap,
} from "./instructions";

const agent = (overrides: Partial<InstructionsAgent>): InstructionsAgent => ({
  id: "codex",
  name: "Codex",
  installed: true,
  status: "direct",
  file: "project:AGENTS.md",
  via: null,
  also: [],
  shared_with: [],
  detail: "Reads AGENTS.md.",
  warnings: [],
  override_file: null,
  ...overrides,
});

describe("Instructions helpers", () => {
  it("round-trips every target through its key without sending a path", () => {
    for (const target of [
      { type: "global" },
      { type: "folder", folder_id: "f:1" },
      { type: "chat", chat_id: "c-2" },
    ] as const) {
      expect(parseTargetKey(targetKey(target))).toEqual(target);
    }
    expect(parseTargetKey("anything else")).toEqual({ type: "global" });
  });

  it("uses volt only for what needs the person and a hollow circle for absent agents", () => {
    expect(statusWord(agent({}))).toEqual({ word: "Reads it", tone: "quiet" });
    expect(statusWord(agent({ status: "drift" })).tone).toBe("volt");
    expect(statusWord(agent({ status: "not_set" })).tone).toBe("volt");
    expect(statusWord(agent({ status: "override" })).tone).toBe("volt");
    expect(statusWord(agent({ status: "copy" })).tone).toBe("quiet");
    expect(statusWord(agent({ installed: false, status: "not_set" }))).toEqual({
      word: "Not installed",
      tone: "off",
    });
    expect(statusWord(agent({ status: "unsupported" })).tone).toBe("off");
  });

  it("names agents plainly", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["Codex"])).toBe("Codex");
    expect(listNames(["Codex", "Pi", "OpenCode"])).toBe("Codex, Pi and OpenCode");
  });

  it("edits only the source in one-file mode and every read or creatable file per agent", async () => {
    const universal = await createInstructionsFixture("universal").api.snapshot({ type: "global" });
    expect(editableFiles(universal).map((file) => file.key)).toEqual(["project:AGENTS.md"]);
    expect(modeSentence(universal)).toBe("AGENTS.md holds the text every agent reads.");
    const perAgent = await createInstructionsFixture("per-agent").api.snapshot({ type: "global" });
    // GEMINI.md is Antigravity's own file; Antigravity isn't installed, so it isn't offered.
    expect(editableFiles(perAgent).map((file) => file.key)).toEqual([
      "project:AGENTS.md",
      "project:CLAUDE.md",
      "project:AGENTS.override.md",
    ]);
    expect(modeSentence(perAgent)).toBe("Agents read different files here.");
  });

  it("says plainly who shares a file and who would read one not created yet", async () => {
    const universal = await createInstructionsFixture("universal").api.snapshot({ type: "global" });
    const shared = fileByKey(universal, "project:AGENTS.md");
    expect(shared && readersSentence(universal, shared)).toBe("Every agent reads this file.");
    const perAgent = await createInstructionsFixture("universal").api.snapshot({ type: "global" });
    const override = fileByKey(perAgent, "project:AGENTS.override.md");
    expect(override && readersSentence(perAgent, override)).toBe(
      "Once created, Codex and Pi read it instead of AGENTS.md.",
    );
    const gemini = fileByKey(perAgent, "project:GEMINI.md");
    expect(gemini && readersSentence(perAgent, gemini)).toBe(
      "Once created, Antigravity reads it as well.",
    );
    const split = await createInstructionsFixture("per-agent").api.snapshot({ type: "global" });
    const agentsFile = fileByKey(split, "project:AGENTS.md");
    expect(agentsFile && readersSentence(split, agentsFile)).toBe(
      "Every agent reads this file except Claude Code.",
    );
  });

  it("counts agents that read a file through an import or a managed copy", async () => {
    const global = await createInstructionsFixture("drift").api.snapshot({ type: "global" });
    const source = fileByKey(global, global.source);
    expect(source && readersSentence(global, source)).toBe(
      "Read by Codex, Claude Code, Pi and 1 more.",
    );
  });

  it("offers worktree help only for files new worktree chats would miss", async () => {
    const snapshot = await createInstructionsFixture("universal").api.snapshot({ type: "global" });
    const must = (key: string) => {
      const found = fileByKey(snapshot, key);
      if (!found) throw new Error(`${key} is missing from the fixture`);
      return found;
    };
    expect(worktreeGap(must("project:CLAUDE.md"))).toEqual({ commit: true });
    expect(worktreeGap(must("project:AGENTS.md"))).toBeNull();
    expect(worktreeGap({ ...must("project:AGENTS.md"), git: "ignored" })).toEqual({
      commit: false,
    });
    expect(worktreeGap(must("project:GEMINI.md"))).toBeNull();
  });
});

describe("Instructions fixture", () => {
  it("changes nothing until Apply and refuses a review it no longer has", async () => {
    const fixture = createInstructionsFixture("conflict");
    const target = { type: "folder", folder_id: "app" } as const;
    const review = await fixture.api.review(target, {
      type: "universal",
      source: "project:AGENTS.md",
      content: { type: "combine" },
      remove: [],
      agents: null,
    });
    expect((await fixture.api.snapshot(target)).mode).toBe("per_agent");
    expect(review.optional_removals).toEqual(["project:AGENTS.override.md"]);
    await fixture.api.apply(review.id);
    const after = await fixture.api.snapshot(target);
    expect(after.mode).toBe("universal");
    expect(fileByKey(after, "project:AGENTS.md")?.text).toContain("# Claude Code");
    await expect(fixture.api.apply(review.id)).rejects.toThrow(/changed after it was displayed/);
    expect(fixture.calls()).toEqual([
      "review:universal:combine",
      "snapshot",
      "apply",
      "snapshot",
      "apply",
    ]);
  });
});

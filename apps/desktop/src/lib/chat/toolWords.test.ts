import { describe, expect, it } from "vitest";
import type { ToolKind } from "../../bindings";
import { type GroupedTool, groupResult, parseTitle, toolPhrase, toolsSummary } from "./toolWords";
import type { ToolDisplayStatus } from "./transcript";

const tools = (...entries: [ToolKind, ToolDisplayStatus][]): GroupedTool[] =>
  entries.map(([toolKind, display]) => ({ toolKind, display }));

describe("a call's line", () => {
  it("says its verb in the tense of its state", () => {
    const read = (display: ToolDisplayStatus) => toolPhrase("Read main.rs", "read", display);
    expect(read("in_progress")).toEqual({ verb: "Reading", object: "main.rs", literal: true });
    expect(read("completed")).toEqual({ verb: "Read", object: "main.rs", literal: true });
    expect(read("pending").verb).toBe("Read");
    const search = (display: ToolDisplayStatus) =>
      toolPhrase("Search for useState", "search", display);
    expect(search("in_progress")).toEqual({
      verb: "Searching for",
      object: "useState",
      literal: true,
    });
    expect(search("completed").verb).toBe("Searched for");
    // Failed and stopped calls keep the agent's own words beside their status.
    expect(search("failed").verb).toBe("Search for");
    expect(search("stopped").verb).toBe("Search for");
    expect(toolPhrase("Write todo.md", "edit", "completed").verb).toBe("Wrote");
    expect(toolPhrase("Find **/*.tsx", "search", "completed").verb).toBe("Found");
  });

  it("sets code in mono and words in sans", () => {
    // A pattern is code even with a space in it; a web query is words.
    expect(toolPhrase("Search for foo bar", "search", "completed").literal).toBe(true);
    expect(toolPhrase("Search the web for tauri effects", "fetch", "completed")).toEqual({
      verb: "Searched the web for",
      object: "tauri effects",
      literal: false,
    });
    expect(toolPhrase("List the project files", "execute", "completed")).toEqual({
      verb: "Listed",
      object: "the project files",
      literal: false,
    });
    expect(toolPhrase("Run cargo test", "execute", "in_progress")).toEqual({
      verb: "Running",
      object: "cargo test",
      literal: true,
    });
    expect(toolPhrase("Run the layout checks", "execute", "completed").literal).toBe(false);
    expect(toolPhrase("Update the to-do list", "other", "completed")).toEqual({
      verb: "Updated",
      object: "the to-do list",
      literal: false,
    });
  });

  it("reads a bare command with Run, Running or Ran", () => {
    expect(toolPhrase("pnpm test -- sidebar", "execute", "pending")).toEqual({
      verb: "Run",
      object: "pnpm test -- sidebar",
      literal: true,
    });
    expect(toolPhrase("ls", "execute", "in_progress").verb).toBe("Running");
    expect(toolPhrase("`git status`", "execute", "completed")).toEqual({
      verb: "Ran",
      object: "git status",
      literal: true,
    });
  });

  it("keeps a title without a verb as it is", () => {
    expect(toolPhrase("Tool", "other", "in_progress")).toEqual({
      verb: null,
      object: "Tool",
      literal: false,
    });
    // A tool name alone, while Claude streams its input, is not inflected.
    expect(toolPhrase("Grep", "search", "in_progress")).toEqual({
      verb: null,
      object: "Grep",
      literal: false,
    });
    expect(toolPhrase("mcp__github__create_issue", "other", "completed").verb).toBeNull();
    expect(toolPhrase("write_file: aura-perm.txt", "edit", "completed")).toEqual({
      verb: "write_file",
      object: "aura-perm.txt",
      literal: true,
    });
    expect(parseTitle("Search the web for x", "fetch")).toEqual({
      verb: "Search",
      particle: "the web for",
      object: "x",
      command: false,
    });
  });
});

describe("a stretch of calls", () => {
  it("reads as one sentence of counts, kinds in the order they came", () => {
    expect(
      toolsSummary(
        tools(
          ["read", "completed"],
          ["search", "completed"],
          ["read", "completed"],
          ["execute", "completed"],
          ["read", "completed"],
        ),
      ),
    ).toBe("Read 3 files, searched for 1 pattern and ran 1 command");
    expect(toolsSummary(tools(["edit", "completed"], ["edit", "failed"]))).toBe("Edited 2 files");
    expect(toolsSummary(tools(["fetch", "completed"], ["other", "completed"]))).toBe(
      "Browsed 1 page and used 1 tool",
    );
    expect(toolsSummary(tools(["switch_mode", "completed"], ["switch_mode", "completed"]))).toBe(
      "Changed mode 2 times",
    );
  });

  it("is in the progressive while any call runs", () => {
    expect(toolsSummary(tools(["read", "completed"], ["read", "in_progress"]))).toBe(
      "Reading 2 files",
    );
    expect(toolsSummary(tools(["search", "completed"], ["execute", "pending"]))).toBe(
      "Searching for 1 pattern and running 1 command",
    );
  });

  it("shows failures and stops at its end and keeps the rest for screen readers", () => {
    expect(groupResult(tools(["read", "completed"], ["read", "failed"]))).toEqual({
      text: "1 failed",
      tone: "failed",
    });
    expect(groupResult(tools(["execute", "failed"]))).toEqual({ text: "Failed", tone: "failed" });
    expect(groupResult(tools(["execute", "stopped"], ["read", "stopped"]))).toEqual({
      text: "2 stopped",
      tone: "stopped",
    });
    expect(groupResult(tools(["read", "in_progress"]))).toEqual({
      text: "Running",
      tone: "quiet",
    });
    expect(groupResult(tools(["read", "completed"]))).toEqual({ text: "Done", tone: "quiet" });
  });
});

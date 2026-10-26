import { describe, expect, it } from "vitest";
import type { ToolKind } from "../fixture/types";
import { familyOf, runSummary, type SummaryCall, toolLabel, toolTarget } from "./tools";

const call = (kind: ToolKind, target: string | null, title = "Tool"): SummaryCall => ({
  kind,
  target,
  title,
});

describe("familyOf", () => {
  it("groups exploration, edits, commands and the rest", () => {
    const families = Object.fromEntries(
      (
        [
          "read",
          "search",
          "fetch",
          "think",
          "edit",
          "delete",
          "move",
          "execute",
          "switch_mode",
          "other",
        ] as const
      ).map((kind) => [kind, familyOf(kind)]),
    );
    expect(families).toEqual({
      read: "explore",
      search: "explore",
      fetch: "explore",
      think: "explore",
      edit: "edit",
      delete: "edit",
      move: "edit",
      execute: "execute",
      switch_mode: "other",
      other: "other",
    });
  });
});

describe("toolTarget", () => {
  it("prefers locations, then the agent's structured input, then the title", () => {
    expect(toolTarget("read", "Read", [{ path: "a/b.ts", line: null }], null)).toBe("a/b.ts");
    expect(toolTarget("edit", "Edit", [], { file_path: "c.ts" })).toBe("c.ts");
    expect(toolTarget("edit", "Edit", [], { path: "d.ts" })).toBe("d.ts");
    expect(toolTarget("read", "Read", [], null)).toBeNull();
    expect(toolTarget("search", "grep x", [], { pattern: "performance.now" })).toBe(
      "performance.now",
    );
    expect(toolTarget("search", "grep x", [], null)).toBe("grep x");
    expect(toolTarget("execute", "Run", [], { command: "pnpm test" })).toBe("pnpm test");
    expect(toolTarget("execute", "Run", [], { command: ["cargo", "test"] })).toBe("cargo test");
    expect(toolTarget("execute", "  ", [], { command: [] })).toBeNull();
    expect(toolTarget("fetch", "Fetch", [], { url: "https://example.com/a" })).toBe(
      "https://example.com/a",
    );
    expect(toolTarget("other", "Anything", [], { path: "x" })).toBeNull();
  });
});

describe("toolLabel", () => {
  it("names a call in the past, while it runs, and while it waits", () => {
    expect(toolLabel("read", "packages/ui/src/orb/pacing.ts", "Read", "past")).toBe(
      "Read pacing.ts",
    );
    expect(toolLabel("read", "packages/ui/src/orb/pacing.ts", "Read", "active")).toBe(
      "Reading pacing.ts",
    );
    expect(toolLabel("execute", "cargo test -p aura-drivers", "Run", "waiting")).toBe(
      "Waiting to run cargo test -p aura-drivers",
    );
    expect(toolLabel("search", "performance.now", "grep", "past")).toBe(
      'Searched for "performance.now"',
    );
    expect(toolLabel("edit", "src/App.tsx", "Edit", "past")).toBe("Edited App.tsx");
    expect(toolLabel("fetch", "https://example.com/docs", "Fetch", "active")).toBe(
      "Fetching example.com",
    );
  });

  it("falls back to the agent's title when nothing names the target", () => {
    expect(toolLabel("read", null, "Read a file", "past")).toBe("Read a file");
    expect(toolLabel("other", null, "Ask the oracle", "active")).toBe("Ask the oracle");
    expect(toolLabel("other", null, "  ", "past")).toBe("Used a tool");
    expect(toolLabel("switch_mode", null, "", "waiting")).toBe("Waiting for approval");
  });
});

describe("runSummary", () => {
  it("reads one call, or several on one target, as that call", () => {
    expect(runSummary([call("execute", "pnpm test")])).toBe("Ran pnpm test");
    expect(runSummary([call("read", "a/x.ts"), call("read", "a/x.ts")])).toBe("Read x.ts");
    expect(runSummary([])).toBe("");
  });

  it("counts kinds in order of first appearance, distinct targets for files", () => {
    expect(
      runSummary([call("read", "a.ts"), call("read", "b.ts"), call("search", "performance.now")]),
    ).toBe("Read 2 files, searched 1 pattern");
    expect(runSummary([call("search", "x"), call("read", "a.ts"), call("read", "a.ts")])).toBe(
      "Searched 1 pattern, read 1 file",
    );
    expect(runSummary([call("edit", "a.ts"), call("edit", "b.ts")])).toBe("Edited 2 files");
    expect(runSummary([call("execute", "a"), call("execute", "b")])).toBe("Ran 2 commands");
    expect(runSummary([call("delete", "a"), call("move", "b")])).toBe(
      "Deleted 1 file, moved 1 file",
    );
  });

  it("counts calls without a target one by one", () => {
    expect(runSummary([call("other", null), call("other", null)])).toBe("Used 2 tools");
    expect(runSummary([call("fetch", "u1"), call("fetch", "u2"), call("think", null)])).toBe(
      "Fetched 2 pages, thought 1 time",
    );
  });
});

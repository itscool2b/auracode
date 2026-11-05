import { describe, expect, it } from "vitest";
import { runLabel } from "./worktreeRun";

describe("Run's name for its command", () => {
  it("names the program without its folder or .exe, then its arguments", () => {
    expect(
      runLabel({ program: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/c", "pnpm dev"] }),
    ).toBe("cmd /d /c pnpm dev");
    expect(runLabel({ program: "/usr/local/bin/pnpm", args: ["dev"] })).toBe("pnpm dev");
    expect(runLabel({ program: "node.EXE", args: [] })).toBe("node");
  });
});

import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => "setup-slot") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { worktreeSetupApi } from "./worktreeSetup";

describe("native setup admission", () => {
  it("reserves through the generation-bound backend rather than the generic terminal pool", async () => {
    const transport = worktreeSetupApi.terminal("chat", "reviewed-command");
    await transport.reserve();
    expect(invoke).toHaveBeenLastCalledWith("worktree_setup_reserve", {
      chatId: "chat",
      token: "reviewed-command",
    });
    await transport.start("setup-slot", "unused", { rows: 24, cols: 80 });
    expect(invoke).toHaveBeenLastCalledWith("worktree_setup_start", {
      chatId: "chat",
      token: "reviewed-command",
      terminalId: "setup-slot",
      rows: 24,
      cols: 80,
    });
  });
});

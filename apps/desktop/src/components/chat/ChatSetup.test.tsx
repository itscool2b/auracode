import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ManagedWorktree, WorktreeSetupAttempt } from "../../bindings";
import { worktreeRecoveryApi } from "../../lib/worktreeRecovery";
import { worktreeSetupApi } from "../../lib/worktreeSetup";
import { ChatSetup } from "./ChatSetup";
import { WorktreeRecoveryList } from "./WorktreeRecoveryList";

describe("durable setup and retained worktree discovery", () => {
  const attempt: WorktreeSetupAttempt = {
    worktree_id: "tree",
    generation: 1,
    state: "running",
    detail: null,
  };
  it("keeps setup separate from the normal composer and offers concrete retry", () => {
    const running = renderToStaticMarkup(
      <ChatSetup chatId="chat" attempt={attempt} api={worktreeSetupApi} terminals={null} />,
    );
    expect(running).toContain("Setup is running. You can queue messages below.");
    expect(running).not.toContain("dialog");
    const failed = renderToStaticMarkup(
      <ChatSetup
        chatId="chat"
        attempt={{
          ...attempt,
          state: "interrupted",
          detail: "Setup was interrupted by a restart.",
        }}
        api={worktreeSetupApi}
        terminals={null}
      />,
    );
    expect(failed).toContain("Setup was interrupted by a restart.");
    expect(failed).toContain("Retry setup");
  });
  it("shows branch, source, retained path and recovery for a record without any chat", () => {
    const record: ManagedWorktree = {
      id: "tree",
      chat_id: "chat-never-saved",
      source: "/project/source",
      path: "/profile/worktrees/retained",
      branch: "aura/kept-work",
      base_commit: "abc",
      state: "recovery_required",
      detail: "The chat could not be saved. Rollback retained changed files.",
      recovery: { type: "create" },
      created_at: 1,
    };
    const html = renderToStaticMarkup(
      <WorktreeRecoveryList records={[record]} api={worktreeRecoveryApi} onChanged={vi.fn()} />,
    );
    for (const text of [
      record.source,
      record.path,
      record.branch,
      record.detail,
      "Review recovery",
      "Open folder",
    ])
      expect(html).toContain(text);
    const reconciled = renderToStaticMarkup(
      <WorktreeRecoveryList
        records={[{ ...record, state: "ready", detail: null }]}
        api={worktreeRecoveryApi}
        onChanged={vi.fn()}
      />,
    );
    expect(reconciled).toContain("retained without a saved chat");
    expect(reconciled).toContain("Open folder");
  });
});

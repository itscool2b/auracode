import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FolderBlockers } from "../../bindings";
import { chatSummary } from "../../lib/chat/testing";
import { blockersFromChats, busyFolder } from "../../lib/folderBusy";
import { CommandError } from "../../lib/ipc";
import { FolderBusy } from "./FolderBusy";

const blockers: FolderBlockers = {
  chats: [
    {
      chat_id: "a",
      title: "Fix the tests",
      agent_name: "Claude Code",
      project: "auracode",
      state: "working",
    },
    { chat_id: "b", title: null, agent_name: "Codex", project: null, state: "waiting" },
  ],
  terminals: 1,
};

describe("a folder in use", () => {
  it("names each chat with its project and what it does, and offers to stop them", () => {
    const html = renderToStaticMarkup(<FolderBusy blockers={blockers} onStopped={() => {}} />);
    expect(html).toContain("Chats are working in this folder");
    expect(html).toContain("Fix the tests in auracode: working");
    expect(html).toContain("Codex chat: waiting for your answer");
    expect(html).toContain("A project terminal is open in this folder. Close it to continue.");
    expect(html).toMatch(/<button[^>]*>Stop these chats<\/button>/);
  });

  it("says one chat in the singular, and offers nothing to stop for terminals alone", () => {
    const one = { chats: blockers.chats.slice(0, 1), terminals: 0 };
    const html = renderToStaticMarkup(<FolderBusy blockers={one} onStopped={() => {}} />);
    expect(html).toContain("A chat is working in this folder");
    expect(html).toMatch(/<button[^>]*>Stop this chat<\/button>/);
    const terminals = renderToStaticMarkup(
      <FolderBusy blockers={{ chats: [], terminals: 2 }} onStopped={() => {}} />,
    );
    expect(terminals).toContain("2 project terminals are open in this folder");
    expect(terminals).not.toContain("<button");
  });

  it("reads the blockers from Rust's refusal, and New chat's busy chats as blockers", () => {
    expect(busyFolder(new CommandError("folder_busy", "In use.", blockers))).toBe(blockers);
    expect(busyFolder(new CommandError("invalid_argument", "No."))).toBeNull();
    expect(busyFolder(new Error("plain"))).toBeNull();
    const waiting = { ...chatSummary("w", { title: "Docs" }), needs_attention: true };
    expect(blockersFromChats([waiting], () => "web")).toEqual({
      chats: [
        {
          chat_id: "w",
          title: "Docs",
          agent_name: waiting.agent_name,
          project: "web",
          state: "waiting",
        },
      ],
      terminals: 0,
    });
  });
});

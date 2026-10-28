import { describe, expect, it } from "vitest";
import type { WorkspaceChat, WorkspaceSnapshot } from "../bindings";
import { chatSummary } from "./chat/testing";
import { type NavigationLists, navigationTarget } from "./nativeNavigation";

const entry = (id: string, archived: boolean): WorkspaceChat => ({
  chat: chatSummary(id),
  project_id: "project",
  folder_id: "folder",
  pinned: false,
  archived,
});
const workspace: WorkspaceSnapshot = {
  projects: [],
  chats: [entry("active", false), entry("archived", true)],
};
const loaded: NavigationLists = {
  chats: [chatSummary("active")],
  chatsFailed: false,
  workspace,
  workspacePending: false,
};

describe("notification navigation", () => {
  it("opens a chat this profile has", () => {
    expect(navigationTarget("active", loaded)).toEqual({
      kind: "open",
      chatId: "active",
      archived: false,
    });
  });

  it("opens an archived chat in the archived view", () => {
    expect(navigationTarget("archived", loaded)).toEqual({
      kind: "open",
      chatId: "archived",
      archived: true,
    });
  });

  it("ignores an unknown chat instead of selecting nothing", () => {
    expect(navigationTarget("deleted", loaded)).toEqual({ kind: "ignore" });
    expect(
      navigationTarget("deleted", { ...loaded, workspace: null, workspacePending: false }),
    ).toEqual({ kind: "ignore" });
  });

  it("opens a chat the live list has before the workspace refreshes", () => {
    expect(navigationTarget("fresh", { ...loaded, chats: [chatSummary("fresh")] })).toMatchObject({
      kind: "open",
      chatId: "fresh",
      archived: false,
    });
  });

  it("waits while the lists that could know the chat are still loading", () => {
    const loading: NavigationLists = {
      chats: null,
      chatsFailed: false,
      workspace: null,
      workspacePending: true,
    };
    expect(navigationTarget("active", loading)).toEqual({ kind: "wait" });
    // The live list never lists archived chats, so an unknown ID waits for the workspace.
    expect(navigationTarget("archived", { ...loading, chats: [chatSummary("active")] })).toEqual({
      kind: "wait",
    });
    expect(navigationTarget("active", { ...loading, workspacePending: false })).toEqual({
      kind: "wait",
    });
  });

  it("gives up once every list failed", () => {
    expect(
      navigationTarget("active", {
        chats: null,
        chatsFailed: true,
        workspace: null,
        workspacePending: false,
      }),
    ).toEqual({ kind: "ignore" });
  });
});

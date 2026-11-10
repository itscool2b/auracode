import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRevision, ProjectMemory, ProjectMemoryChanged } from "../bindings";

const native = vi.hoisted(() => ({ available: true, listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("./ipc", () => ({ inTauri: () => native.available, settle: vi.fn() }));

import {
  type AgentEditNotice,
  adoptsSaved,
  agentEditText,
  agentEditToast,
  agentLabel,
  MAX_MEMORY_BYTES,
  MEMORY_CHANGED_ANYWHERE,
  memoryBytes,
  memoryChats,
  newerVersion,
  noticeAgentEdit,
  PROJECT_MEMORY_CHANGED,
  subscribeProjectMemory,
  undoAgentEdit,
} from "./projectMemory";

const memory: ProjectMemory = {
  project_id: "one",
  revision: "r2",
  markdown: "Current",
  updated_at: 1,
};
const revision = (id: string, parent: string | null, markdown: string, source = "user") =>
  ({
    revision: id,
    parent_revision: parent,
    project_id: "one",
    markdown,
    reason: `Saved ${id}`,
    source,
    created_at: 1793505600000,
  }) satisfies MemoryRevision;
const chats = memoryChats([
  { id: "login", title: "Fix the login flow", agent_name: "Claude Code" },
  { id: "untitled", title: null, agent_name: "Codex" },
]);
const edit = (id: string, parent: string | null, chat = "login"): ProjectMemoryChanged => ({
  project_id: "one",
  agent_edit: { revision: id, parent_revision: parent, chat_id: chat },
});

describe("project memory", () => {
  it("counts UTF-8 bytes without silently truncating Markdown", () => {
    expect(memoryBytes("é")).toBe(2);
    expect(memoryBytes("é".repeat(MAX_MEMORY_BYTES / 2))).toBe(MAX_MEMORY_BYTES);
    expect(memoryBytes("é".repeat(MAX_MEMORY_BYTES / 2 + 1))).toBeGreaterThan(MAX_MEMORY_BYTES);
  });
});

describe("agent names", () => {
  it("lets live chat titles follow saved ones", () => {
    const named = memoryChats([
      { id: "login", title: null, agent_name: "Claude Code" },
      { id: "login", title: "Renamed chat", agent_name: "Claude Code" },
    ]);
    expect(agentLabel("login", named)).toBe("Claude Code in Renamed chat");
  });
});

describe("live refresh", () => {
  const newer: ProjectMemory = { ...memory, revision: "r3", markdown: "Agent edit" };
  it("takes a newer version into an editor without a draft", () => {
    expect(adoptsSaved(memory, newer, memory.markdown)).toBe(true);
    expect(newerVersion(memory, newer, memory.markdown)).toBeNull();
  });
  it("never applies a newer version over a draft, and offers it instead", () => {
    expect(adoptsSaved(memory, newer, "My draft")).toBe(false);
    expect(newerVersion(memory, newer, "My draft")).toEqual(newer);
  });
  it("ignores the same revision and another project's memory", () => {
    expect(newerVersion(memory, memory, "My draft")).toBeNull();
    expect(adoptsSaved(memory, memory, memory.markdown)).toBe(false);
    const other = { ...newer, project_id: "two" };
    expect(newerVersion(memory, other, "My draft")).toBeNull();
    expect(adoptsSaved(memory, other, memory.markdown)).toBe(false);
    expect(newerVersion(null, newer, "")).toBeNull();
  });
});

describe("agent edit notices", () => {
  it("shows only agents' new revisions", () => {
    expect(noticeAgentEdit([], MEMORY_CHANGED_ANYWHERE)).toEqual([]);
    expect(noticeAgentEdit([], { project_id: "one", agent_edit: null })).toEqual([]);
    const [notice] = noticeAgentEdit([], edit("r2", "r1"));
    expect(notice).toEqual({
      projectId: "one",
      revision: "r2",
      restores: "r1",
      chats: ["login"],
      edits: 1,
      state: { status: "shown" },
    });
  });
  it("folds edits that follow each other, so Undo returns to before the first", () => {
    let notices = noticeAgentEdit([], edit("r2", "r1"));
    notices = noticeAgentEdit(notices, edit("r3", "r2"));
    notices = noticeAgentEdit(notices, edit("r4", "r3", "untitled"));
    expect(notices).toEqual([
      {
        projectId: "one",
        revision: "r4",
        restores: "r1",
        chats: ["login", "untitled"],
        edits: 3,
        state: { status: "shown" },
      },
    ]);
    // The same event twice changes nothing.
    expect(noticeAgentEdit(notices, edit("r4", "r3"))).toBe(notices);
  });
  it("starts again after anything in between, and after an undo", () => {
    const first = noticeAgentEdit([], edit("r2", "r1"));
    // The person saved r3 in between: Undo must never discard it.
    expect(noticeAgentEdit(first, edit("r4", "r3"))).toEqual([
      expect.objectContaining({ revision: "r4", restores: "r3", edits: 1 }),
    ]);
    const undone = first.map((notice) => ({ ...notice, state: { status: "undone" } as const }));
    expect(noticeAgentEdit(undone, edit("r3", "r2"))).toEqual([
      expect.objectContaining({ revision: "r3", restores: "r2", edits: 1 }),
    ]);
  });
  it("keeps the newest three projects", () => {
    let notices: readonly AgentEditNotice[] = [];
    for (const project of ["a", "b", "c", "d"])
      notices = noticeAgentEdit(notices, { ...edit(`${project}2`, null), project_id: project });
    expect(notices.map((notice) => notice.projectId)).toEqual(["b", "c", "d"]);
  });
  it("says who edited, how often, and what Undo did", () => {
    const [one] = noticeAgentEdit([], edit("r2", "r1"));
    if (!one) throw new Error("notice");
    expect(agentEditText(one, chats, "auracode")).toBe(
      "Claude Code in Fix the login flow updated project memory for auracode.",
    );
    expect(agentEditText({ ...one, chats: ["gone"] }, chats, null)).toBe(
      "An agent updated project memory.",
    );
    expect(agentEditText({ ...one, edits: 2, chats: ["login", "untitled"] }, chats, "x")).toBe(
      "Agents in 2 chats made 2 edits to project memory for x.",
    );
    expect(agentEditText({ ...one, state: { status: "undone" } }, chats, "auracode")).toBe(
      "Undone. The project memory for auracode is back to its revision before this edit.",
    );
  });
  it("puts the edit on a toast: a short title, then who and where on one line", () => {
    const [one] = noticeAgentEdit([], edit("r2", "r1"));
    if (!one) throw new Error("notice");
    expect(agentEditToast(one, chats, "auracode")).toEqual({
      title: "Project memory updated",
      detail: "Claude Code · Fix the login flow · auracode",
    });
    expect(agentEditToast({ ...one, chats: ["gone"] }, chats, null)).toEqual({
      title: "Project memory updated",
      detail: "An agent",
    });
    expect(agentEditToast({ ...one, edits: 2, chats: ["login", "untitled"] }, chats, "x")).toEqual({
      title: "2 edits to project memory",
      detail: "Agents in 2 chats · x",
    });
    expect(agentEditToast({ ...one, state: { status: "undone" } }, chats, "auracode")).toEqual({
      title: "Edit undone",
      detail: "Project memory for auracode is back to its revision before this edit.",
    });
  });
});

describe("undoing an agent's edit", () => {
  const notice: AgentEditNotice = {
    projectId: "one",
    revision: "r3",
    restores: "r1",
    chats: ["login"],
    edits: 2,
    state: { status: "shown" },
  };
  const history = [
    revision("r3", "r2", "Second agent edit", "agent:login"),
    revision("r2", "r1", "First agent edit", "agent:login"),
    revision("r1", null, "Owner notes"),
  ];
  it("saves what the edits replaced as the person's revision, only over their result", async () => {
    const save = vi.fn(async () => memory);
    await undoAgentEdit({ history: async () => history, save }, notice, chats);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      project_id: "one",
      expected_revision: "r3",
      markdown: "Owner notes",
      reason: "Undid 2 edits by Claude Code in Fix the login flow",
    });
  });
  it("empties memory an agent wrote first, and names an unknown agent in lower case", async () => {
    const save = vi.fn(async () => memory);
    const history = vi.fn(async () => []);
    await undoAgentEdit(
      { history, save },
      { ...notice, restores: null, edits: 1, chats: ["gone"] },
      chats,
    );
    expect(history).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: "", reason: "Undid an edit by an agent" }),
    );
  });
  it("refuses when the earlier revision is missing, and passes a stale save's refusal on", async () => {
    const save = vi.fn(async () => memory);
    await expect(undoAgentEdit({ history: async () => [], save }, notice, chats)).rejects.toThrow(
      "not on this device",
    );
    expect(save).not.toHaveBeenCalled();
    await expect(
      undoAgentEdit(
        {
          history: async () => history,
          save: async () => {
            throw new Error("Project memory changed. Review the current revision before saving.");
          },
        },
        notice,
        chats,
      ),
    ).rejects.toThrow("Project memory changed");
  });
});

describe("memory change events", () => {
  beforeEach(() => {
    native.available = true;
    native.listen.mockReset();
  });
  it("forwards memory changes and finished syncs, and stops on disposal", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const stops = [vi.fn(), vi.fn()];
    native.listen.mockImplementation(async (name: string, handler) => {
      handlers.set(name, handler);
      return stops[handlers.size - 1];
    });
    const changed = vi.fn();
    const stop = subscribeProjectMemory(changed);
    await Promise.resolve();
    await Promise.resolve();
    const change = edit("r2", "r1");
    handlers.get(PROJECT_MEMORY_CHANGED)?.({ payload: change });
    handlers.get("account-sync-changed")?.({ payload: ["profile", { state: "syncing" }] });
    handlers.get("account-sync-changed")?.({ payload: ["profile", { state: "idle" }] });
    expect(changed.mock.calls).toEqual([[change], [MEMORY_CHANGED_ANYWHERE]]);
    stop();
    handlers.get(PROJECT_MEMORY_CHANGED)?.({ payload: change });
    expect(changed).toHaveBeenCalledTimes(2);
    for (const unlisten of stops) expect(unlisten).toHaveBeenCalledOnce();
  });
  it("releases a listener that registers after the page left, and needs the native app", async () => {
    let finish: (stop: () => void) => void = () => {};
    native.listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = subscribeProjectMemory(vi.fn());
    stop();
    const late = vi.fn();
    finish(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late).toHaveBeenCalledOnce();
    native.available = false;
    native.listen.mockReset();
    subscribeProjectMemory(vi.fn())();
    expect(native.listen).not.toHaveBeenCalled();
  });
});

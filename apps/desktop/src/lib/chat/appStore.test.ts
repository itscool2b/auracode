import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEntry, EnvStatus, StorageStatus } from "../../bindings";
import { CommandError } from "../ipc";
import {
  AppStore,
  agentChoice,
  DETECTION_POLL_MS,
  NewChatDraft,
  STATUS_RESUBSCRIBE_MS,
  STORAGE_ALERT_POLL_MS,
  STORAGE_POLL_MS,
} from "./appStore";
import { chatSummary, FakeTransport, OK_STORAGE, settled } from "./testing";

function agent(id: string, availability: AgentEntry["availability"]): AgentEntry {
  return {
    id,
    name: id,
    description: "",
    availability,
    launch: id,
    needs_download: false,
    last_verified: "",
  };
}

const PAUSED: StorageStatus = {
  state: { state: "paused", reason: "disk_full", since: 1 },
  unsaved_bytes: 10,
};

describe("the app store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads chats, env, storage and agents, and keeps the list current from the status channel", async () => {
    const fake = new FakeTransport({
      chatsList: () =>
        Promise.resolve([
          chatSummary("old", { updated_at: 1 }),
          chatSummary("new", { updated_at: 5 }),
        ]),
    });
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.methods().slice(0, 5)).toEqual([
      "statusSubscribe",
      "chatsList",
      "storageStatus",
      "envStatus",
      "agentsList",
    ]);
    expect(store.getSnapshot().chats?.map((chat) => chat.id)).toEqual(["new", "old"]);

    fake.statusChannels[0]?.onUpdate({
      chat_id: "old",
      status: "running",
      needs_attention: true,
      title: "Fix the test",
      updated_at: 9,
    });
    const chats = store.getSnapshot().chats ?? [];
    expect(chats.map((chat) => chat.id)).toEqual(["old", "new"]);
    expect(chats[0]).toMatchObject({
      status: "running",
      needs_attention: true,
      title: "Fix the test",
    });

    // A chat this window does not list yet (created elsewhere) reloads the list.
    fake.statusChannels[0]?.onUpdate({
      chat_id: "other",
      status: "starting",
      needs_attention: false,
      title: null,
      updated_at: 10,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsOf("chatsList")).toHaveLength(2);
    store.stop();
  });

  it("subscribes again when the status channel ends, and catches up", async () => {
    const fake = new FakeTransport();
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    fake.statusChannels[0]?.onEnd();
    await vi.advanceTimersByTimeAsync(STATUS_RESUBSCRIBE_MS);
    expect(fake.callsOf("statusSubscribe")).toHaveLength(2);
    expect(fake.callsOf("chatsList")).toHaveLength(2);
    store.stop();
  });

  it("ignores the end of a subscription it replaced, so a restart never loops", async () => {
    const fake = new FakeTransport();
    const store = new AppStore(fake);
    // React's development mode starts, stops and starts again.
    store.start();
    store.stop();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsOf("statusSubscribe")).toHaveLength(2);
    // The shell ends the first channel, replaced by the second: nothing follows.
    fake.statusChannels[0]?.onEnd();
    fake.statusChannels[0]?.onUpdate({
      chat_id: "stale",
      status: "ready",
      needs_attention: false,
      title: null,
      updated_at: 1,
    });
    await vi.advanceTimersByTimeAsync(10 * STATUS_RESUBSCRIBE_MS);
    expect(fake.callsOf("statusSubscribe")).toHaveLength(2);
    expect(fake.callsOf("chatsList")).toHaveLength(2);
    store.stop();
  });

  it("polls storage faster while saving is paused", async () => {
    let storage = OK_STORAGE;
    const fake = new FakeTransport({ storageStatus: () => Promise.resolve(storage) });
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsOf("storageStatus")).toHaveLength(1);
    storage = PAUSED;
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(store.getSnapshot().storage).toEqual(PAUSED);
    await vi.advanceTimersByTimeAsync(STORAGE_ALERT_POLL_MS);
    expect(fake.callsOf("storageStatus")).toHaveLength(3);
    storage = OK_STORAGE;
    await vi.advanceTimersByTimeAsync(STORAGE_ALERT_POLL_MS);
    expect(store.getSnapshot().storage).toEqual(OK_STORAGE);
    store.stop();
    await vi.advanceTimersByTimeAsync(10 * STORAGE_POLL_MS);
    expect(fake.callsOf("storageStatus")).toHaveLength(4);
  });

  it("follows the env while it resolves, and Retry starts a new resolution", async () => {
    const resolving: EnvStatus = { state: { state: "resolving" }, removed: [] };
    const fallback: EnvStatus = {
      state: { state: "fallback", reason: "the login shell timed out" },
      removed: ["CLAUDECODE"],
    };
    let env = resolving;
    const fake = new FakeTransport({
      envStatus: () => Promise.resolve(env),
      envRefresh: () => Promise.resolve(resolving),
    });
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    env = fallback;
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(store.getSnapshot().env).toEqual(fallback);
    await vi.advanceTimersByTimeAsync(10 * DETECTION_POLL_MS);
    expect(fake.callsOf("envStatus")).toHaveLength(2);

    await store.retryEnv();
    expect(store.getSnapshot().env).toEqual(resolving);
    env = {
      state: { state: "ready", source: "zsh login shell", took_ms: 80, vars: 30 },
      removed: [],
    };
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(store.getSnapshot().env?.state.state).toBe("ready");
    store.stop();
  });

  it("follows agents still being checked, and Refresh probes them again", async () => {
    let agents = [agent("mock", { state: "checking" })];
    const fake = new FakeTransport({
      agentsList: () => Promise.resolve(agents),
      agentsRefresh: () =>
        Promise.resolve([agent("mock", { state: "ready", version: "1", path: "builtin" })]),
    });
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    agents = [agent("mock", { state: "ready", version: null, path: "builtin" })];
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(store.getSnapshot().agents?.[0]?.availability.state).toBe("ready");
    await vi.advanceTimersByTimeAsync(10 * DETECTION_POLL_MS);
    expect(fake.callsOf("agentsList")).toHaveLength(2);
    const refreshing = store.refreshAgents();
    expect(store.getSnapshot().agentsRefreshing).toBe(true);
    await refreshing;
    expect(store.getSnapshot().agentsRefreshing).toBe(false);
    expect(fake.callsOf("agentsRefresh")).toHaveLength(1);
    store.stop();
  });

  it("adds a chat this window created at the top", async () => {
    const fake = new FakeTransport({
      chatsList: () => Promise.resolve([chatSummary("a", { updated_at: 1 })]),
    });
    const store = new AppStore(fake);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    store.addChat(chatSummary("b", { updated_at: 2 }));
    expect(store.getSnapshot().chats?.map((chat) => chat.id)).toEqual(["b", "a"]);
    store.stop();
  });
});

describe("choosing an agent", () => {
  it("unavailable_agent_disabled: a missing or broken agent is disabled with its reason", () => {
    expect(
      agentChoice(agent("hermes", { state: "missing", reason: "hermes was not found." })),
    ).toEqual({
      enabled: false,
      reason: "hermes was not found.",
    });
    expect(
      agentChoice(
        agent("claude-acp", {
          state: "broken",
          reason: "Node.js 22 or newer is required (found 20.11.0).",
        }),
      ),
    ).toEqual({ enabled: false, reason: "Node.js 22 or newer is required (found 20.11.0)." });
    // Ready and still-checking agents can be chosen: the start waits for the detection.
    expect(agentChoice(agent("mock", { state: "checking" })).enabled).toBe(true);
    expect(agentChoice(agent("mock", { state: "ready", version: null, path: "x" })).enabled).toBe(
      true,
    );
  });
});

describe("the New chat draft", () => {
  it("picker_cancel: cancelling the folder picker changes nothing", async () => {
    let answer: string | null = "/Users/me/code/app";
    const fake = new FakeTransport({ pickFolder: () => Promise.resolve(answer) });
    const draft = new NewChatDraft(fake);
    await draft.chooseFolder();
    expect(draft.getSnapshot().folder).toBe("/Users/me/code/app");
    const before = draft.getSnapshot();
    answer = null;
    await draft.chooseFolder();
    expect(draft.getSnapshot()).toEqual(before);
    expect(fake.methods()).toEqual(["pickFolder", "pickFolder"]);
  });

  it("creates the chat with the agent and folder chosen, and shows a refusal inline", async () => {
    const fake = new FakeTransport({
      pickFolder: () => Promise.resolve("/tmp/missing"),
      chatCreate: (agentId) =>
        agentId === "hermes"
          ? Promise.reject(
              new CommandError(
                "invalid_folder",
                "/tmp/missing can't be used as the chat's folder: it doesn't exist.",
              ),
            )
          : Promise.resolve(chatSummary("c9")),
    });
    const draft = new NewChatDraft(fake);
    expect(await draft.create()).toBeNull();
    expect(fake.methods()).toEqual([]);
    draft.chooseAgent("hermes");
    await draft.chooseFolder();
    expect(await draft.create()).toBeNull();
    expect(draft.getSnapshot().error).toBe(
      "/tmp/missing can't be used as the chat's folder: it doesn't exist.",
    );
    draft.chooseAgent("mock");
    expect(draft.getSnapshot().error).toBeNull();
    const chat = await draft.create();
    expect(chat?.id).toBe("c9");
    expect(fake.callsOf("chatCreate")).toEqual([
      ["hermes", "/tmp/missing"],
      ["mock", "/tmp/missing"],
    ]);
    await settled();
  });

  it("shows a picker that could not open", async () => {
    const fake = new FakeTransport({
      pickFolder: () =>
        Promise.reject(new CommandError("dialog_failed", "The folder picker could not be shown.")),
    });
    const draft = new NewChatDraft(fake);
    await draft.chooseFolder();
    expect(draft.getSnapshot()).toMatchObject({
      picking: false,
      folder: null,
      error: "The folder picker could not be shown.",
    });
  });
});

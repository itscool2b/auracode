import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSnapshot, HistoryPage, SessionLists } from "../../bindings";
import { CommandError } from "../ipc";
import { BLOB_PAGE, ChatStore, LISTS_DEBOUNCE_MS, STILL_WORKING_MS } from "./chatStore";
import {
  attachResult,
  autonomyState,
  chatSummary,
  ev,
  FakeTransport,
  frame,
  historyPage,
  items,
  lists,
  numbered,
  OK_STORAGE,
  sessionInfo,
  settled,
} from "./testing";

const CHAT = "c1";

/** A store whose first attach is answered with `page` at `nextSeq`. */
async function opened(
  fake: FakeTransport,
  page: HistoryPage = historyPage(CHAT, []),
  nextSeq = 0,
  snapshot: Partial<ChatSnapshot> = {},
): Promise<ChatStore> {
  const store = new ChatStore(CHAT, fake);
  const opening = store.open();
  fake.lastAttach().resolve(attachResult(CHAT, nextSeq, page, snapshot));
  await opening;
  await settled();
  return store;
}

function messageText(store: ChatStore, id: string): string | null {
  const item = store.getSnapshot().transcript.items.get(`message:${id}`);
  return item?.kind === "message" ? item.text : null;
}

describe("joining a chat (the join protocol)", () => {
  it("applies the page, then the frames buffered during the attach from next_seq on", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore(CHAT, fake);
    const opening = store.open();
    expect(store.getSnapshot().phase).toBe("attaching");
    const pending = fake.lastAttach();
    // Frames arrive before the attach answers: one the page already holds, then newer ones.
    pending.onFrame(frame(CHAT, 2, [ev.message("t1.m1", " world")]));
    pending.onFrame(frame(CHAT, 3, [ev.message("t1.m1", "!")]));
    const page = historyPage(
      CHAT,
      items(
        numbered([
          ["t1", ev.turnStarted("t1")],
          ["t1", ev.message("t1.m1", "hello")],
        ]),
      ),
    );
    pending.resolve(attachResult(CHAT, 3, page));
    await opening;
    expect(store.getSnapshot().phase).toBe("live");
    // seq 2 was below next_seq (3): skipped; seq 3 applied.
    expect(messageText(store, "t1.m1")).toBe("hello!");
    // Live frames continue from there.
    pending.onFrame(frame(CHAT, 4, [ev.message("t1.m1", "!")]));
    expect(messageText(store, "t1.m1")).toBe("hello!!");
    expect(fake.methods()).toEqual(["attach", "lists"]);
  });

  it("gap_reattaches: a frame past the expected seq detaches and joins again", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 10);
    const first = fake.lastAttach();
    first.onFrame(frame(CHAT, 10, [ev.notice("ok")]));
    first.onFrame(frame(CHAT, 13, [ev.notice("after a gap")]));
    await settled();
    expect(fake.methods()).toEqual(["attach", "lists", "detach", "attach"]);
    expect(fake.callsOf("detach")).toEqual([["sub-c1-10"]]);
    expect(store.getSnapshot().phase).toBe("attaching");
    // The old channel is ignored from now on.
    first.onFrame(frame(CHAT, 11, [ev.notice("late")]));
    fake.lastAttach().resolve(attachResult(CHAT, 14, historyPage(CHAT, [])));
    await settled();
    expect(store.getSnapshot().phase).toBe("live");
    expect(store.getSnapshot().transcript.items.has("notice:11")).toBe(false);
  });

  it("gap_reattaches: the channel ending joins again", async () => {
    const fake = new FakeTransport();
    await opened(fake);
    fake.lastAttach().onEnd();
    await settled();
    expect(fake.methods()).toEqual(["attach", "lists", "detach", "attach"]);
  });

  it("reattach_detaches_first: the old subscription goes before the new attach", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const fake = new FakeTransport({
      detach: (id) => {
        order.push(`detach ${id}`);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const store = await opened(fake);
    const rejoin = store.reattach();
    await settled();
    expect(fake.attaches).toHaveLength(1);
    release();
    await settled();
    order.push("attach");
    expect(fake.attaches).toHaveLength(2);
    expect(order).toEqual(["detach sub-c1-0", "attach"]);
    fake.lastAttach().resolve(attachResult(CHAT, 0, historyPage(CHAT, [])));
    await rejoin;
  });

  it("a refused attach shows why, without looping, and retries on Retry and storage changes", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore(CHAT, fake);
    const opening = store.open();
    const pending = fake.lastAttach();
    // The shell drops the refused view's channel as well.
    pending.onEnd();
    pending.reject(
      new CommandError("storage_unavailable", "auracode's database is not available."),
    );
    await opening;
    await settled();
    expect(store.getSnapshot()).toMatchObject({
      phase: "failed",
      attachError: "auracode's database is not available.",
    });
    expect(fake.attaches).toHaveLength(1);

    store.storageChanged(OK_STORAGE);
    await settled();
    expect(fake.attaches).toHaveLength(2);
    fake.lastAttach().reject(new CommandError("storage_unavailable", "still not"));
    await settled();
    // The same status again is no change.
    store.storageChanged(OK_STORAGE);
    await settled();
    expect(fake.attaches).toHaveLength(2);

    void store.reattach();
    await settled();
    expect(fake.attaches).toHaveLength(3);
    fake.lastAttach().resolve(attachResult(CHAT, 0, historyPage(CHAT, [])));
    await settled();
    expect(store.getSnapshot().phase).toBe("live");
  });

  it("backs off when joins keep losing their subscription", async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeTransport({
        attach: (chatId, _onFrame, onEnd) => {
          onEnd();
          return Promise.resolve(attachResult(chatId, 0, historyPage(chatId, [])));
        },
      });
      const store = new ChatStore(CHAT, fake);
      await store.open();
      await vi.advanceTimersByTimeAsync(0);
      // Two at once, then a growing pause instead of a spin.
      expect(fake.callsOf("attach")).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(249);
      expect(fake.callsOf("attach")).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.callsOf("attach")).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(500);
      expect(fake.callsOf("attach")).toHaveLength(5);
      store.close();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fake.callsOf("attach")).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closing detaches and ignores whatever still arrives", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake);
    const channel = fake.lastAttach();
    store.close();
    expect(fake.callsOf("detach")).toEqual([["sub-c1-0"]]);
    channel.onFrame(frame(CHAT, 0, [ev.notice("late")]));
    channel.onEnd();
    await settled();
    expect(store.getSnapshot().transcript.segments).toEqual([]);
    expect(fake.attaches).toHaveLength(1);
  });

  it("detaches an attach answered after the view closed", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore(CHAT, fake);
    const opening = store.open();
    store.close();
    fake.lastAttach().resolve(attachResult(CHAT, 5, historyPage(CHAT, [])));
    await opening;
    expect(fake.callsOf("detach")).toEqual([["sub-c1-5"]]);
  });
});

describe("the agent of each turn", () => {
  it("keeps the agent that ran each turn after the chat switches agents, through a reload", async () => {
    const fake = new FakeTransport();
    const page = historyPage(
      CHAT,
      items(
        numbered([
          ["t1", ev.turnStarted("t1")],
          ["t1", ev.turnEnded("t1", "refusal")],
        ]),
      ),
      {
        turn_agents: [{ turn_id: "t1", agent_id: "claude", agent_name: "Claude Code" }],
      },
    );
    // The chat now runs Codex: the failed Claude Code turn keeps its own agent.
    const store = await opened(fake, page, 2, {
      chat: chatSummary(CHAT, { agent_id: "codex", agent_name: "Codex" }),
      session: sessionInfo({ agent_name: "Codex" }),
    });
    expect(store.getSnapshot().turnAgents.get("t1")?.agent_name).toBe("Claude Code");
    // A turn that starts live runs on the chat's agent of that moment.
    fake.lastAttach().onFrame(frame(CHAT, 2, [ev.turnStarted("t2")]));
    expect(store.getSnapshot().turnAgents.get("t2")).toEqual({
      turn_id: "t2",
      agent_id: "codex",
      agent_name: "Codex",
    });
    expect(store.getSnapshot().turnAgents.get("t1")?.agent_id).toBe("claude");
  });

  it("adds the agents an older page names without losing the newer ones", async () => {
    const older = historyPage(CHAT, items(numbered([["t1", ev.turnStarted("t1")]])), {
      turn_agents: [{ turn_id: "t1", agent_id: "claude", agent_name: "Claude Code" }],
    });
    const fake = new FakeTransport({ history: () => Promise.resolve(older) });
    const newest = historyPage(CHAT, items(numbered([["t2", ev.turnStarted("t2")]], 5)), {
      has_more: true,
      before_seq: 5,
      turn_agents: [{ turn_id: "t2", agent_id: "codex", agent_name: "Codex" }],
    });
    const store = await opened(fake, newest, 6);
    await store.loadEarlier();
    const agents = store.getSnapshot().turnAgents;
    expect([...agents.keys()].sort()).toEqual(["t1", "t2"]);
    expect(agents.get("t1")?.agent_name).toBe("Claude Code");
    expect(agents.get("t2")?.agent_name).toBe("Codex");
  });
});

describe("history pages", () => {
  it("live frames do not finish a pending older-page restore", async () => {
    const older = historyPage(CHAT, items(numbered([[null, ev.notice("older")]])), {
      has_more: false,
      before_seq: 0,
    });
    let answer: (page: typeof older) => void = () => {};
    const fake = new FakeTransport({
      history: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const newest = historyPage(CHAT, [], { has_more: true, before_seq: 1 });
    const store = await opened(fake, newest, 1);
    const loading = store.loadEarlier();
    fake.lastAttach().onFrame(frame(CHAT, 1, [ev.notice("live while loading")]));
    expect(store.getSnapshot()).toMatchObject({ loadingEarlier: true, historyRevision: 0 });
    answer(older);
    await loading;
    expect(store.getSnapshot()).toMatchObject({ loadingEarlier: false, historyRevision: 1 });
    expect(store.getSnapshot().transcript.items.size).toBe(2);
    store.close();
  });

  it("partial_turn_page: a cut page starts inside its turn, and Load earlier continues it", async () => {
    const whole = numbered([
      ["t1", ev.turnStarted("t1")],
      ["t1", ev.user("t1.u", "Long")],
      ["t1", ev.message("t1.m1", "one ")],
      ["t1", ev.message("t1.m1", "two")],
      ["t1", ev.turnEnded("t1")],
    ]);
    const older = historyPage(CHAT, items(whole.slice(0, 2)), { has_more: false, before_seq: 0 });
    const fake = new FakeTransport({ history: () => Promise.resolve(older) });
    const newest = historyPage(CHAT, items(whole.slice(2)), {
      has_more: true,
      before_seq: 2,
      cut_turn_id: "t1",
    });
    const store = await opened(fake, newest, 5);
    let state = store.getSnapshot();
    expect(state.hasMore).toBe(true);
    expect(state.historyRevision).toBe(0);
    expect(state.transcript.segments[0]).toMatchObject({ key: "turn:t1", partial: true });

    await store.loadEarlier();
    expect(fake.callsOf("history")).toEqual([[CHAT, 2]]);
    state = store.getSnapshot();
    expect(state.hasMore).toBe(false);
    expect(state.historyRevision).toBe(1);
    expect(state.transcript.segments).toHaveLength(1);
    expect(state.transcript.segments[0]).toMatchObject({ key: "turn:t1", partial: false });
    expect(state.transcript.segments[0]?.itemKeys).toEqual(["user:t1.u", "message:t1.m1"]);
    expect(messageText(store, "t1.m1")).toBe("one two");
    await store.loadEarlier();
    expect(fake.callsOf("history")).toHaveLength(1);
  });

  it("unsaved_marker_and_reattach: the gap is marked, and the view joins again once saving resumes", async () => {
    const fake = new FakeTransport();
    const page = historyPage(CHAT, items(numbered([[null, ev.notice("saved")]])), {
      unsaved_from: 1,
    });
    const paused = {
      state: { state: "paused" as const, reason: "disk_full" as const, since: 1 },
      unsaved_bytes: 300,
    };
    const store = await opened(fake, page, 6, { storage: paused });
    fake.lastAttach().onFrame(frame(CHAT, 6, [ev.notice("live")]));
    const state = store.getSnapshot();
    expect(state.unsavedFrom).toBe(1);
    expect(state.transcript.segments[0]?.itemKeys).toEqual(["notice:0", "gap:1", "notice:6"]);

    store.storageChanged(paused);
    await settled();
    expect(fake.attaches).toHaveLength(1);
    store.storageChanged(OK_STORAGE);
    await settled();
    expect(fake.methods().slice(-2)).toEqual(["detach", "attach"]);
  });
});

describe("the session's live state", () => {
  it("follows the queue through the prompt lifecycle and marks the prompts a stop holds", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake);
    const channel = fake.lastAttach();
    // As the actor flushes: each flush ends with the session's update when it changed.
    channel.onFrame(frame(CHAT, 0, [ev.session({ status: "running" })]));
    channel.onFrame(
      frame(CHAT, 1, [ev.lifecycle("p2", "queued", "second"), ev.session({ status: "running" })]),
    );
    channel.onFrame(
      frame(CHAT, 3, [ev.lifecycle("p3", "queued", "third"), ev.session({ status: "running" })]),
    );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.preview, row.held])).toEqual([
      ["p2", "second", false],
      ["p3", "third", false],
    ]);
    // A stop holds every prompt queued until now; one typed afterwards is not held.
    channel.onFrame(frame(CHAT, 5, [ev.session({ status: "cancelling", queue_held: true })]));
    channel.onFrame(
      frame(CHAT, 6, [
        ev.lifecycle("p4", "queued", "fourth"),
        ev.lifecycle("p2", "cancelled"),
        ev.session({ status: "cancelling", queue_held: true }),
      ]),
    );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["p3", true],
      ["p4", false],
    ]);
    // Send queued releases them.
    channel.onFrame(frame(CHAT, 9, [ev.session({ status: "ready", queue_held: false })]));
    expect(store.getSnapshot().queue.every((row) => !row.held)).toBe(true);
    channel.onFrame(frame(CHAT, 10, [ev.lifecycle("p3", "started"), ev.usage(0.5), ev.limits()]));
    expect(store.getSnapshot().queue.map((row) => row.prompt_id)).toEqual(["p4"]);
    expect(store.getSnapshot().usage?.cost?.amount).toBe(0.5);
    expect(store.getSnapshot().limits).toEqual([]);
    await settled();
    expect(fake.methods(), "every hold was placed without joining again").toEqual([
      "attach",
      "lists",
    ]);
  });

  it("joins again for the exact queue when an error holds prompts while others were held", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      session: sessionInfo({ status: "running", queue_held: true }),
      queue: [{ prompt_id: "a", preview: "older", held: true, created_at: 1 }],
    });
    const channel = fake.lastAttach();
    // A prompt typed during the turn waits behind it, unheld...
    channel.onFrame(
      frame(CHAT, 0, [
        ev.lifecycle("c", "queued", "typed during the turn"),
        ev.session({ status: "running", queue_held: true }),
      ]),
    );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["a", true],
      ["c", false],
    ]);
    // ...until the turn ends with an error, which holds it too: queue_held was true already, so
    // nothing in the frames says the typed prompt is held now.
    channel.onFrame(
      frame(CHAT, 2, [
        ev.error("agent_error", "The agent failed."),
        ev.session({ status: "ready", queue_held: true }),
      ]),
    );
    await settled();
    expect(fake.methods().slice(-2)).toEqual(["detach", "attach"]);
    expect(store.getSnapshot().session?.queue_held, "Send queued shows meanwhile").toBe(true);
    fake.lastAttach().resolve(
      attachResult(CHAT, 4, historyPage(CHAT, []), {
        session: sessionInfo({ status: "ready", queue_held: true }),
        queue: [
          { prompt_id: "a", preview: "older", held: true, created_at: 1 },
          { prompt_id: "c", preview: "typed during the turn", held: true, created_at: 2 },
        ],
      }),
    );
    await settled();
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["a", true],
      ["c", true],
    ]);
    // With the older one removed, the typed prompt still shows held and Send queued still shows.
    fake
      .lastAttach()
      .onFrame(
        frame(CHAT, 4, [
          ev.lifecycle("a", "cancelled"),
          ev.session({ status: "ready", queue_held: true }),
        ]),
      );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["c", true],
    ]);
    expect(store.getSnapshot().session?.queue_held).toBe(true);
    await settled();
    expect(fake.callsOf("attach")).toHaveLength(2);
  });

  it("joins again when a prompt was queued as the hold ran", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      session: sessionInfo({ status: "running" }),
    });
    const channel = fake.lastAttach();
    channel.onFrame(
      frame(CHAT, 0, [ev.lifecycle("p1", "queued", "first"), ev.session({ status: "running" })]),
    );
    // The flush that reports the stop also carries a prompt typed in the same moment: it may
    // have come before the hold or after it.
    channel.onFrame(
      frame(CHAT, 2, [
        ev.lifecycle("p2", "queued", "second"),
        ev.session({ status: "cancelling", queue_held: true }),
      ]),
    );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["p1", true],
      ["p2", false],
    ]);
    await settled();
    expect(fake.methods().slice(-2)).toEqual(["detach", "attach"]);
  });

  it("marks nothing held for a start that fails, which holds nothing", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      session: sessionInfo({ status: "stopped", queue_held: true }),
      queue: [{ prompt_id: "a", preview: "held at the restart", held: true, created_at: 1 }],
    });
    const channel = fake.lastAttach();
    // A prompt sent to a stopped chat starts it; the start fails.
    channel.onFrame(
      frame(CHAT, 0, [
        ev.lifecycle("b", "queued", "new"),
        ev.session({ status: "starting", queue_held: true }),
      ]),
    );
    channel.onFrame(
      frame(CHAT, 2, [
        ev.error("spawn_failed", "Could not start the agent."),
        ev.session({ status: "failed", queue_held: true }),
      ]),
    );
    expect(store.getSnapshot().queue.map((row) => [row.prompt_id, row.held])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    await settled();
    expect(fake.methods()).toEqual(["attach", "lists"]);
  });

  it("lists_refetch_on_revision: a new revision refetches the lists, debounced", async () => {
    vi.useFakeTimers();
    try {
      let revision = 1;
      const fake = new FakeTransport({ lists: () => Promise.resolve(lists(revision)) });
      const store = await opened(fake, historyPage(CHAT, []), 0, {
        session: sessionInfo({ revision: 1 }),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.callsOf("lists")).toHaveLength(1);
      const channel = fake.lastAttach();
      revision = 3;
      channel.onFrame(frame(CHAT, 0, [ev.session({ revision: 2 })]));
      await vi.advanceTimersByTimeAsync(LISTS_DEBOUNCE_MS - 50);
      channel.onFrame(frame(CHAT, 1, [ev.session({ revision: 3 })]));
      channel.onFrame(frame(CHAT, 2, [ev.session({ revision: 3, status: "running" })]));
      await vi.advanceTimersByTimeAsync(LISTS_DEBOUNCE_MS - 1);
      expect(fake.callsOf("lists")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.callsOf("lists")).toHaveLength(2);
      expect(store.getSnapshot().lists?.revision).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auth_card_lists_commands: entering auth_required joins again for the sign-in commands", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      session: sessionInfo({ status: "running" }),
    });
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.session({ status: "stopping" })]));
    fake
      .lastAttach()
      .onFrame(frame(CHAT, 1, [ev.session({ status: "auth_required", queue_held: true })]));
    await settled();
    expect(fake.methods().slice(-2)).toEqual(["detach", "attach"]);
    const auth = {
      message: "Codex needs you to sign in.",
      commands: [
        {
          label: "Sign in with ChatGPT",
          argv: ["codex", "login"],
          env: [["CODEX_HOME", "/tmp/x"] as [string, string]],
        },
      ],
    };
    fake.lastAttach().resolve(
      attachResult(CHAT, 2, historyPage(CHAT, []), {
        session: sessionInfo({ status: "auth_required", queue_held: true }),
        auth,
      }),
    );
    await settled();
    expect(store.getSnapshot().auth).toEqual(auth);
    // Already fresh: another auth_required update joins no more.
    fake
      .lastAttach()
      .onFrame(frame(CHAT, 2, [ev.session({ status: "auth_required", revision: 2 })]));
    await settled();
    expect(fake.attaches).toHaveLength(2);
    // Leaving auth_required drops the prompt.
    fake.lastAttach().onFrame(frame(CHAT, 3, [ev.session({ status: "starting" })]));
    expect(store.getSnapshot().auth).toBeNull();
  });
});

describe("the pickers", () => {
  it("set an option or the autonomy and show the lists the shell answers, or why not", async () => {
    const fake = new FakeTransport({
      setOption: (_chat, optionId) =>
        optionId === "bad"
          ? Promise.reject(new CommandError("option_invalid", "The agent refused that value."))
          : Promise.resolve(lists(7)),
      setAutonomy: () =>
        Promise.resolve(
          lists(8, {
            autonomy: {
              requested: "ask",
              native_mode: "default",
              auto_answer: { type: "never" },
              note: "Applies when the agent starts.",
            },
          }),
        ),
    });
    const store = await opened(fake);
    await store.setOption("model", { type: "choice", value: "smart" });
    expect(store.getSnapshot().lists?.revision).toBe(7);
    await store.setOption("bad", { type: "toggle", value: true });
    expect(store.getSnapshot().listsError).toBe("The agent refused that value.");
    expect(store.getSnapshot().lists?.revision).toBe(7);
    await store.setAutonomy("ask");
    expect(store.getSnapshot().lists?.autonomy.note).toBe("Applies when the agent starts.");
    expect(store.getSnapshot().listsError).toBeNull();
    expect(fake.calls.slice(2).map((call) => [call.method, ...call.args])).toEqual([
      ["setOption", CHAT, "model", { type: "choice", value: "smart" }],
      ["setOption", CHAT, "bad", { type: "toggle", value: true }],
      ["setAutonomy", CHAT, "ask"],
    ]);
  });

  it("keep the newest change's lists when an older answer arrives last, and show what is on its way", async () => {
    const answers = new Map<string, (answer: SessionLists) => void>();
    const fake = new FakeTransport({
      setOption: (_chat, _option, value) =>
        new Promise((resolve) => {
          answers.set(value.type === "choice" ? value.value : String(value.value), resolve);
        }),
      setAutonomy: (_chat, autonomy) => new Promise((resolve) => answers.set(autonomy, resolve)),
    });
    const store = await opened(fake);
    const fast = store.setOption("model", { type: "choice", value: "fast" });
    const smart = store.setOption("model", { type: "choice", value: "smart" });
    // The picker shows the newest value asked for while the calls run.
    expect(store.getSnapshot().optionsSaving.get("model")).toEqual({
      type: "choice",
      value: "smart",
    });
    answers.get("smart")?.(lists(11));
    await smart;
    expect(store.getSnapshot().lists?.revision).toBe(11);
    expect(store.getSnapshot().optionsSaving.size).toBe(0);
    // The first change answers last: its lists are older, so they are ignored.
    answers.get("fast")?.(lists(10));
    await fast;
    expect(store.getSnapshot().lists?.revision).toBe(11);
    expect(store.getSnapshot().optionsSaving.size).toBe(0);

    // The same for the autonomy; a refusal clears what was on its way and says why.
    const ask = store.setAutonomy("ask");
    expect(store.getSnapshot().autonomySaving).toBe("ask");
    answers.get("ask")?.(lists(12, { autonomy: autonomyState("ask") }));
    await ask;
    expect(store.getSnapshot()).toMatchObject({ autonomySaving: null, listsError: null });
    expect(store.getSnapshot().lists?.autonomy.requested).toBe("ask");
    fake.handlers.setOption = () =>
      Promise.reject(
        new CommandError("session_not_ready", "The agent isn't running in this chat."),
      );
    await store.setOption("model", { type: "choice", value: "fast" });
    expect(store.getSnapshot()).toMatchObject({
      listsError: "The agent isn't running in this chat.",
    });
    expect(store.getSnapshot().optionsSaving.size).toBe(0);
    expect(store.getSnapshot().lists?.revision).toBe(12);
  });

  it("keep the newest lists when an older refetch answers late", async () => {
    let answer: (value: ReturnType<typeof lists>) => void = () => {};
    let calls = 0;
    const fake = new FakeTransport({
      lists: () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => (answer = resolve));
        return Promise.resolve(lists(1));
      },
      setOption: () => Promise.resolve(lists(9)),
    });
    const store = await opened(fake);
    await store.setOption("model", { type: "choice", value: "fast" });
    answer(lists(2));
    await settled();
    expect(store.getSnapshot().lists?.revision).toBe(9);
  });
});

describe("history errors", () => {
  it("shows why an older page could not load, and Load earlier tries again", async () => {
    let fail = true;
    const fake = new FakeTransport({
      history: () =>
        fail
          ? Promise.reject(
              new CommandError("storage_unavailable", "auracode's database is not available: busy"),
            )
          : Promise.resolve(historyPage(CHAT, [], { has_more: false })),
    });
    const store = await opened(fake, historyPage(CHAT, [], { has_more: true, before_seq: 10 }), 20);
    await store.loadEarlier();
    expect(store.getSnapshot()).toMatchObject({
      loadingEarlier: false,
      earlierError: "auracode's database is not available: busy",
      historyRevision: 0,
      hasMore: true,
    });
    fail = false;
    await store.loadEarlier();
    expect(store.getSnapshot()).toMatchObject({
      earlierError: null,
      hasMore: false,
      historyRevision: 1,
    });
  });
});

describe("prompts and the session", () => {
  it("sends text as typed, refuses blank text, and keeps a failure for the composer", async () => {
    const fake = new FakeTransport({
      send: (_chat, text) =>
        text === "too much"
          ? Promise.reject(
              new CommandError("queue_full", "20 messages are already waiting in this chat."),
            )
          : Promise.resolve({ prompt_id: "p", queued: false }),
    });
    const store = await opened(fake);
    expect(await store.send("   \n")).toBe(false);
    expect(fake.callsOf("send")).toEqual([]);
    expect(await store.send("  keep my spaces  ")).toBe(true);
    expect(fake.callsOf("send")).toEqual([[CHAT, "  keep my spaces  "]]);
    expect(await store.send("too much")).toBe(false);
    expect(store.getSnapshot().sendError).toBe("20 messages are already waiting in this chat.");
    expect(await store.send("fine")).toBe(true);
    expect(store.getSnapshot().sendError).toBeNull();
  });

  it("escape_twice: Esc interrupts a running turn, and the next Esc force-stops", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      session: sessionInfo({ status: "running" }),
    });
    await store.escape();
    await store.escape();
    expect(fake.methods().filter((m) => m === "interrupt" || m === "forceStop")).toEqual([
      "interrupt",
      "forceStop",
    ]);
    // While the agent cancels, Esc force-stops; with no turn, Esc does nothing.
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.session({ status: "cancelling" })]));
    await store.escape();
    fake.lastAttach().onFrame(frame(CHAT, 1, [ev.session({ status: "ready" })]));
    expect(store.escape()).toBeNull();
    expect(fake.methods().filter((m) => m === "interrupt" || m === "forceStop")).toEqual([
      "interrupt",
      "forceStop",
      "forceStop",
    ]);
    // A start is interrupted (the shell treats it as a force stop).
    fake.lastAttach().onFrame(frame(CHAT, 2, [ev.session({ status: "starting" })]));
    await store.escape();
    expect(fake.methods().at(-1)).toBe("interrupt");
  });

  it("starts, stops, resumes the queue and removes queued prompts", async () => {
    const fake = new FakeTransport({
      cancelQueued: () => Promise.reject(new CommandError("request_not_pending", "gone")),
      stop: () =>
        Promise.reject(new CommandError("chat_not_found", "There is no chat with id c1.")),
    });
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      queue: [{ prompt_id: "p1", preview: "hi", held: true, created_at: 1 }],
    });
    await store.start(true);
    await store.resumeQueue();
    await store.cancelQueued("p1");
    expect(store.getSnapshot().queue).toEqual([]);
    expect(store.getSnapshot().actionError).toBeNull();
    await store.stop();
    expect(store.getSnapshot().actionError).toBe("There is no chat with id c1.");
    await store.revealLog();
    expect(store.getSnapshot().actionError).toBeNull();
    expect(fake.calls.slice(2).map((call) => [call.method, ...call.args])).toEqual([
      ["start", CHAT, true],
      ["resumeQueue", CHAT],
      ["cancelQueued", CHAT, "p1"],
      ["stop", CHAT],
      ["revealLog", CHAT],
    ]);
  });

  it("edits and reorders queued prompts from the shell's exact queue", async () => {
    const row = (prompt_id: string, preview: string, held = false) => ({
      prompt_id,
      preview,
      held,
      created_at: 1,
    });
    const fake = new FakeTransport({
      queuedText: async (_chat, id) => (id === "p1" ? "frist draft" : "later"),
      editQueued: async (_chat, _id, text) =>
        text.trim() === ""
          ? Promise.reject(new CommandError("prompt_empty", "The message is empty."))
          : [row("p1", text), row("p2", "later", true)],
      moveQueued: async () => [row("p2", "later", true), row("p1", "first draft")],
    });
    const store = await opened(fake, historyPage(CHAT, []), 0, {
      queue: [row("p1", "frist draft"), row("p2", "later", true)],
    });
    expect(await store.queuedText("p1")).toBe("frist draft");
    expect(await store.editQueued("p1", "first draft")).toBeNull();
    expect(store.getSnapshot().queue.map((item) => item.preview)).toEqual(["first draft", "later"]);
    // A refused edit keeps the queue and says why, for the editor to show; the header stays quiet.
    expect(await store.editQueued("p1", " ")).toBe("The message is empty.");
    expect(store.getSnapshot().queue[0]?.preview).toBe("first draft");
    expect(store.getSnapshot().actionError).toBeNull();
    await store.moveQueued("p2", 0);
    expect(store.getSnapshot().queue).toEqual([row("p2", "later", true), row("p1", "first draft")]);
    expect(fake.calls.slice(2).map((call) => [call.method, ...call.args])).toEqual([
      ["queuedText", CHAT, "p1"],
      ["editQueued", CHAT, "p1", "first draft"],
      ["editQueued", CHAT, "p1", " "],
      ["moveQueued", CHAT, "p2", 0],
    ]);
  });

  it("drops a queued prompt that started or was removed before an edit or a move", async () => {
    const gone = () => Promise.reject(new CommandError("request_not_pending", "gone"));
    const fake = new FakeTransport({ queuedText: gone, editQueued: gone, moveQueued: gone });
    const queue = [
      { prompt_id: "p1", preview: "one", held: false, created_at: 1 },
      { prompt_id: "p2", preview: "two", held: false, created_at: 2 },
      { prompt_id: "p3", preview: "three", held: false, created_at: 3 },
    ];
    const store = await opened(fake, historyPage(CHAT, []), 0, { queue });
    expect(await store.queuedText("p1")).toBeNull();
    expect(await store.editQueued("p2", "x")).toBeNull();
    await store.moveQueued("p3", 0);
    expect(store.getSnapshot().queue).toEqual([]);
    expect(store.getSnapshot().actionError).toBeNull();
  });
});

describe("cards and questions", () => {
  it("permission_card_flow: buttons disable on click and the resolution closes the card", async () => {
    let answer: () => void = () => {};
    const fake = new FakeTransport({
      respondPermission: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const store = await opened(fake);
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.permission("r1")]));
    const responding = store.respondPermission("r1", "allow");
    expect(store.getSnapshot().requests.get("r1")).toEqual({
      busy: true,
      gone: false,
      error: null,
    });
    // A second click while the answer is on its way sends nothing more.
    await store.respondPermission("r1", "reject");
    expect(fake.callsOf("respondPermission")).toEqual([[CHAT, "r1", "allow"]]);
    answer();
    await responding;
    expect(store.getSnapshot().requests.get("r1")?.busy).toBe(true);
    fake.lastAttach().onFrame(frame(CHAT, 1, [ev.permissionResolved("r1", "allow")]));
    expect(store.getSnapshot().requests.has("r1")).toBe(false);
    const card = store.getSnapshot().transcript.items.get("permission:r1");
    expect(card?.kind === "permission" && card.resolution?.by).toBe("user");
  });

  it("permission_card_flow: request_not_pending closes the card; another error re-enables it", async () => {
    const fake = new FakeTransport({
      respondPermission: (_chat, id) =>
        id === "gone"
          ? Promise.reject(
              new CommandError(
                "request_not_pending",
                "This request is no longer waiting for an answer.",
              ),
            )
          : Promise.reject(new CommandError("option_invalid", "That option is not offered.")),
    });
    const store = await opened(fake);
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.permission("gone"), ev.permission("bad")]));
    await store.respondPermission("gone", "allow");
    expect(store.getSnapshot().requests.get("gone")).toEqual({
      busy: false,
      gone: true,
      error: null,
    });
    await store.respondPermission("bad", "nope");
    expect(store.getSnapshot().requests.get("bad")).toEqual({
      busy: false,
      gone: false,
      error: "That option is not offered.",
    });
  });

  it("permission_without_options: Dismiss answers cancelled", async () => {
    const fake = new FakeTransport();
    const store = await opened(fake);
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.permission("r", [])]));
    await store.respondPermission("r", null);
    expect(fake.callsOf("respondPermission")).toEqual([[CHAT, "r", null]]);
  });

  it("question_card_flow: an answer, a dismissal, and request_not_pending", async () => {
    const fake = new FakeTransport({
      respondUi: (_chat, id) =>
        id === "q3"
          ? Promise.reject(
              new CommandError(
                "request_not_pending",
                "This request is no longer waiting for an answer.",
              ),
            )
          : Promise.resolve(),
    });
    const store = await opened(fake);
    const channel = fake.lastAttach();
    channel.onFrame(frame(CHAT, 0, [ev.question("q1"), ev.question("q2"), ev.question("q3")]));
    await store.respondUi("q1", { type: "select", index: 1 });
    await store.respondUi("q2", null);
    await store.respondUi("q3", { type: "select", index: 0 });
    expect(fake.callsOf("respondUi")).toEqual([
      [CHAT, "q1", { type: "select", index: 1 }],
      [CHAT, "q2", null],
      [CHAT, "q3", { type: "select", index: 0 }],
    ]);
    expect(store.getSnapshot().requests.get("q3")?.gone).toBe(true);
    channel.onFrame(
      frame(CHAT, 3, [
        ev.questionResolved("q1", { type: "select", index: 1 }),
        ev.questionResolved("q2", null),
      ]),
    );
    const q1 = store.getSnapshot().transcript.items.get("question:q1");
    expect(q1?.kind === "question" && q1.resolution?.answer).toEqual({ type: "select", index: 1 });
    expect(store.getSnapshot().requests.has("q1")).toBe(false);
  });
});

describe("full outputs", () => {
  it("load_full_output: pages through the blob by next_offset, ending at eof", async () => {
    const sha = "a".repeat(64);
    const pages = new Map([
      [
        0,
        {
          sha256: sha,
          offset: 0,
          next_offset: 262_142,
          total: 300_000,
          text: "first ",
          eof: false,
        },
      ],
      [
        262_142,
        {
          sha256: sha,
          offset: 262_142,
          next_offset: 300_000,
          total: 300_000,
          text: "second",
          eof: true,
        },
      ],
    ]);
    const fake = new FakeTransport({
      blob: (_chat, _sha, offset) => {
        const page = pages.get(offset);
        return page ? Promise.resolve(page) : Promise.reject(new Error(`no page at ${offset}`));
      },
    });
    const store = await opened(fake);
    await store.loadBlob(sha);
    expect(store.getSnapshot().blobs.get(sha)).toMatchObject({
      text: "first ",
      nextOffset: 262_142,
      eof: false,
    });
    await store.loadBlob(sha);
    expect(store.getSnapshot().blobs.get(sha)).toMatchObject({ text: "first second", eof: true });
    await store.loadBlob(sha);
    // Each page asks from where the last one ended (a character boundary), 256 KiB at most.
    expect(fake.callsOf("blob")).toEqual([
      [CHAT, sha, 0, BLOB_PAGE],
      [CHAT, sha, 262_142, BLOB_PAGE],
    ]);
  });

  it("load_full_output: a missing blob says why and can be tried again", async () => {
    const sha = "b".repeat(64);
    let fail = true;
    const fake = new FakeTransport({
      blob: () =>
        fail
          ? Promise.reject(
              new CommandError(
                "blob_missing",
                "The full output isn't saved yet because the disk is full.",
              ),
            )
          : Promise.resolve({
              sha256: sha,
              offset: 0,
              next_offset: 2,
              total: 2,
              text: "ok",
              eof: true,
            }),
    });
    const store = await opened(fake);
    await store.loadBlob(sha);
    expect(store.getSnapshot().blobs.get(sha)?.error).toBe(
      "The full output isn't saved yet because the disk is full.",
    );
    fail = false;
    await store.loadBlob(sha);
    expect(store.getSnapshot().blobs.get(sha)).toMatchObject({
      text: "ok",
      eof: true,
      error: null,
    });
  });
});

describe("still working", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still_working_indicator: shows after a minute without frames during a turn, counting up", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore(CHAT, fake, { now: () => Date.now() });
    const opening = store.open();
    fake.lastAttach().resolve(
      attachResult(CHAT, 0, historyPage(CHAT, []), {
        session: sessionInfo({ status: "running" }),
      }),
    );
    await opening;
    await vi.advanceTimersByTimeAsync(STILL_WORKING_MS - 1);
    expect(store.getSnapshot().stillWorkingMinutes).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().stillWorkingMinutes).toBe(1);
    await vi.advanceTimersByTimeAsync(STILL_WORKING_MS);
    expect(store.getSnapshot().stillWorkingMinutes).toBe(2);
    // A frame resets it; nothing was ever stopped.
    fake.lastAttach().onFrame(frame(CHAT, 0, [ev.message("m", "still here")]));
    expect(store.getSnapshot().stillWorkingMinutes).toBeNull();
    await vi.advanceTimersByTimeAsync(STILL_WORKING_MS);
    expect(store.getSnapshot().stillWorkingMinutes).toBe(1);
    expect(fake.methods()).not.toContain("interrupt");
    expect(fake.methods()).not.toContain("forceStop");
    // Not while no turn runs.
    fake.lastAttach().onFrame(frame(CHAT, 1, [ev.session({ status: "ready" })]));
    expect(store.getSnapshot().stillWorkingMinutes).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * STILL_WORKING_MS);
    expect(store.getSnapshot().stillWorkingMinutes).toBeNull();
    store.close();
  });
});

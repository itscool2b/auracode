import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmokeReport } from "../bindings";
import { errorMessage } from "./errors";
import {
  acknowledgeRecovery,
  agentsList,
  agentsRefresh,
  CommandError,
  cancelDemoStream,
  chatAttach,
  chatBlob,
  chatCancelQueued,
  chatCreate,
  chatDetach,
  chatForceStop,
  chatHistory,
  chatInterrupt,
  chatLists,
  chatRespondPermission,
  chatRespondUi,
  chatResumeQueue,
  chatRevealLog,
  chatSend,
  chatSetAutonomy,
  chatSetOption,
  chatStart,
  chatStop,
  chatsList,
  endingChannel,
  envRefresh,
  envStatus,
  getAppInfo,
  IPC_REJECTED,
  pickFolder,
  revealDataDir,
  sendSmokeReport,
  startDemoStream,
  statusSubscribe,
  storageStatus,
  toCommandError,
  windowReady,
} from "./ipc";

/** What Tauri rejects with when a capability does not grant a command: a plain string. */
const ACL_DENIAL = "Command window_ready not allowed by ACL";

describe("toCommandError", () => {
  it("keeps a command's own AppError", () => {
    const error = toCommandError({ code: "too_many_streams", message: "Stop one first." });
    expect(error).toBeInstanceOf(CommandError);
    expect(error.code).toBe("too_many_streams");
    expect(error.message).toBe("Stop one first.");
  });

  it("keeps Tauri's message when it rejects with a plain string", () => {
    const error = toCommandError(ACL_DENIAL);
    expect(error.code).toBe(IPC_REJECTED);
    expect(error.message).toBe(ACL_DENIAL);
    expect(errorMessage(error)).toBe(ACL_DENIAL);
  });

  it("keeps the message of a thrown Error", () => {
    const error = toCommandError(new TypeError("window.__TAURI_INTERNALS__ is undefined"));
    expect(error.code).toBe(IPC_REJECTED);
    expect(error.message).toBe("window.__TAURI_INTERNALS__ is undefined");
  });

  it("says something when a rejection carries no message", () => {
    for (const rejection of [undefined, null, "", "   ", 42, {}, new Error("")]) {
      const error = toCommandError(rejection);
      expect(error.code).toBe(IPC_REJECTED);
      expect(error.message).not.toBe("");
      expect(errorMessage(error)).not.toBe("Something went wrong.");
    }
  });

  it("does not mistake other objects for an AppError", () => {
    const error = toCommandError({ code: 7, message: ["not", "a", "string"] });
    expect(error.code).toBe(IPC_REJECTED);
  });

  it("passes a CommandError through untouched", () => {
    const original = new CommandError("reveal_failed", "No file manager.");
    expect(toCommandError(original)).toBe(original);
  });
});

describe("command wrappers through the generated bindings", () => {
  beforeEach(() => {
    // Tauri's mocks install the IPC bridge on `window`, which Node lacks.
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    clearMocks();
    Reflect.deleteProperty(globalThis, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(globalThis, "__TAURI_EVENT_PLUGIN_INTERNALS__");
    vi.unstubAllGlobals();
  });

  /** Every call rejects with `rejection`, as Tauri's IPC would. */
  function rejectEverything(rejection: unknown): void {
    mockIPC(() => Promise.reject(rejection));
  }

  it("throws Tauri's own string rejections as CommandErrors with the message intact", async () => {
    rejectEverything(ACL_DENIAL);
    for (const call of [
      () => windowReady(),
      () => getAppInfo(),
      () => cancelDemoStream("s1"),
      () => revealDataDir(),
      () => acknowledgeRecovery(),
      () => startDemoStream({ type: "demo" }, 120, () => {}),
    ]) {
      const error: unknown = await call().then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(CommandError);
      expect(error).toMatchObject({ code: IPC_REJECTED, message: ACL_DENIAL });
      expect(errorMessage(error)).toBe(ACL_DENIAL);
    }
  });

  it("throws a command's AppError with its code", async () => {
    rejectEverything({ code: "too_many_streams", message: "8 demo streams are already running." });
    await expect(startDemoStream({ type: "demo" }, 120, () => {})).rejects.toMatchObject({
      name: "CommandError",
      code: "too_many_streams",
      message: "8 demo streams are already running.",
    });
    rejectEverything({ code: "reveal_failed", message: "Could not show /data." });
    await expect(revealDataDir()).rejects.toMatchObject({ code: "reveal_failed" });
    rejectEverything({ code: "acknowledge_failed", message: "The database is closed." });
    await expect(acknowledgeRecovery()).rejects.toMatchObject({
      name: "CommandError",
      code: "acknowledge_failed",
      message: "The database is closed.",
    });
  });

  it("resolves with the command's value", async () => {
    const report: SmokeReport = {
      ok: true,
      events_received: 1,
      frames_received: 1,
      seq_gaps: 0,
      rendered_chars: 1,
      fps_min: 60,
      fps_avg: 60,
      errors: [],
    };
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "start_demo_stream" ? "session-1" : null;
    });
    await expect(startDemoStream({ type: "demo" }, 120.4, () => {})).resolves.toBe("session-1");
    await expect(windowReady()).resolves.toBeUndefined();
    await expect(sendSmokeReport(report)).resolves.toBeUndefined();
    await expect(revealDataDir()).resolves.toBeUndefined();
    await expect(acknowledgeRecovery()).resolves.toBeUndefined();
    expect(calls).toEqual([
      "start_demo_stream",
      "window_ready",
      "smoke_report",
      "reveal_data_dir",
      "acknowledge_recovery",
    ]);
  });

  it("asks the shell to reveal its own data folder without naming a path", async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === "reveal_data_dir") payloads.push(payload);
      return null;
    });
    await revealDataDir();
    expect(payloads).toHaveLength(1);
    expect(payloads[0] ?? {}).toEqual({});
  });
});

describe("the chat command wrappers", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    clearMocks();
    Reflect.deleteProperty(globalThis, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(globalThis, "__TAURI_EVENT_PLUGIN_INTERNALS__");
    vi.unstubAllGlobals();
  });

  /** Runs a channel's callback as the shell's `eval` would: a message, or the end. */
  function deliver(channel: Channel<unknown>, raw: unknown): void {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      }
    ).__TAURI_INTERNALS__;
    internals.runCallback(channel.id, raw);
  }

  it("names every argument as the shell's commands expect", async () => {
    const calls: { cmd: string; payload: unknown }[] = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return null;
    });
    await chatsList();
    await chatCreate("mock", "/code/app");
    await chatDetach("sub-1");
    await chatHistory("c1", 40);
    await chatLists("c1");
    await chatSend("c1", "  hi  ");
    await chatCancelQueued("c1", "p1");
    await chatResumeQueue("c1");
    await chatInterrupt("c1");
    await chatForceStop("c1");
    await chatStart("c1", true);
    await chatStop("c1");
    await chatRespondPermission("c1", "r1", null);
    await chatRespondUi("c1", "q1", { type: "select", index: 2 });
    await chatSetOption("c1", "model", { type: "choice", value: "fast" });
    await chatSetAutonomy("c1", "ask");
    await chatBlob("c1", "a".repeat(64), 262_144, 262_144);
    await chatRevealLog("c1");
    await pickFolder();
    await agentsList();
    await agentsRefresh();
    await envStatus();
    await envRefresh();
    await storageStatus();
    // A command without arguments sends an empty object.
    expect(calls.map(({ cmd, payload }) => ({ cmd, payload: payload ?? {} }))).toEqual([
      { cmd: "chats_list", payload: {} },
      { cmd: "chat_create", payload: { agentId: "mock", folder: "/code/app" } },
      { cmd: "chat_detach", payload: { subscriptionId: "sub-1" } },
      { cmd: "chat_history", payload: { chatId: "c1", beforeSeq: 40, maxBytes: null } },
      { cmd: "chat_lists", payload: { chatId: "c1" } },
      { cmd: "chat_send", payload: { chatId: "c1", text: "  hi  " } },
      { cmd: "chat_cancel_queued", payload: { chatId: "c1", promptId: "p1" } },
      { cmd: "chat_resume_queue", payload: { chatId: "c1" } },
      { cmd: "chat_interrupt", payload: { chatId: "c1" } },
      { cmd: "chat_force_stop", payload: { chatId: "c1" } },
      { cmd: "chat_start", payload: { chatId: "c1", fresh: true } },
      { cmd: "chat_stop", payload: { chatId: "c1" } },
      {
        cmd: "chat_respond_permission",
        payload: { chatId: "c1", requestId: "r1", optionId: null },
      },
      {
        cmd: "chat_respond_ui",
        payload: { chatId: "c1", requestId: "q1", answer: { type: "select", index: 2 } },
      },
      {
        cmd: "chat_set_option",
        payload: { chatId: "c1", optionId: "model", value: { type: "choice", value: "fast" } },
      },
      { cmd: "chat_set_autonomy", payload: { chatId: "c1", autonomy: "ask" } },
      {
        cmd: "chat_blob",
        payload: { chatId: "c1", sha256: "a".repeat(64), offset: 262_144, len: 262_144 },
      },
      { cmd: "chat_reveal_log", payload: { chatId: "c1" } },
      { cmd: "pick_folder", payload: {} },
      { cmd: "agents_list", payload: {} },
      { cmd: "agents_refresh", payload: {} },
      { cmd: "env_status", payload: {} },
      { cmd: "env_refresh", payload: {} },
      { cmd: "storage_status", payload: {} },
    ]);
  });

  it("throws the shell's codes for the chat commands", async () => {
    mockIPC(() =>
      Promise.reject({
        code: "request_not_pending",
        message: "This request is no longer waiting for an answer.",
      }),
    );
    await expect(chatRespondPermission("c1", "r1", "allow")).rejects.toMatchObject({
      name: "CommandError",
      code: "request_not_pending",
    });
    mockIPC(() =>
      Promise.reject({ code: "dialog_failed", message: "The folder picker could not be shown." }),
    );
    await expect(pickFolder()).rejects.toMatchObject({ code: "dialog_failed" });
  });

  it("delivers a view's frames, before and after the attach answers, then says when the channel ends", async () => {
    let channel: Channel<unknown> | null = null;
    mockIPC((cmd, payload) => {
      if (cmd !== "chat_attach") return null;
      const args = payload as { chatId: string; channel: Channel<unknown> };
      channel = args.channel;
      // A frame before the answer, as the join protocol allows.
      deliver(args.channel, { message: { chat_id: "c1", seq_start: 3, events: [] }, index: 0 });
      return { subscription_id: "sub-1", next_seq: 3 };
    });
    const frames: unknown[] = [];
    let ends = 0;
    const attached = await chatAttach(
      "c1",
      (frame) => frames.push(frame),
      () => {
        ends += 1;
      },
    );
    expect(attached).toMatchObject({ subscription_id: "sub-1" });
    expect(frames).toEqual([{ chat_id: "c1", seq_start: 3, events: [] }]);
    if (channel === null) throw new Error("no channel was passed");
    // Out of order: the end waits for the message sent before it.
    deliver(channel, { end: true, index: 2 });
    expect(ends).toBe(0);
    deliver(channel, { message: { chat_id: "c1", seq_start: 3, events: [] }, index: 1 });
    expect(frames).toHaveLength(2);
    expect(ends).toBe(1);
  });

  it("subscribes to status updates and says when that channel ends", async () => {
    let channel: Channel<unknown> | null = null;
    mockIPC((cmd, payload) => {
      if (cmd === "status_subscribe") channel = (payload as { channel: Channel<unknown> }).channel;
      return "status-1";
    });
    const updates: unknown[] = [];
    let ended = false;
    await expect(
      statusSubscribe(
        (update) => updates.push(update),
        () => {
          ended = true;
        },
      ),
    ).resolves.toBe("status-1");
    if (channel === null) throw new Error("no channel was passed");
    deliver(channel, { message: { chat_id: "c1", status: "ready" }, index: 0 });
    deliver(channel, { end: true, index: 1 });
    expect(updates).toEqual([{ chat_id: "c1", status: "ready" }]);
    expect(ended).toBe(true);
  });

  it("endingChannel wraps only its own channel", () => {
    mockIPC(() => null);
    let ends = 0;
    const one = endingChannel<number>(
      () => {},
      () => {
        ends += 1;
      },
    );
    const other = new Channel<number>();
    deliver(other as Channel<unknown>, { end: true, index: 0 });
    expect(ends).toBe(0);
    deliver(one as Channel<unknown>, { end: true, index: 0 });
    expect(ends).toBe(1);
  });
});

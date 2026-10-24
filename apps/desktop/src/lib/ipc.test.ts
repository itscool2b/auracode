import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmokeReport } from "../bindings";
import { errorMessage } from "./errors";
import {
  CommandError,
  cancelDemoStream,
  getAppInfo,
  IPC_REJECTED,
  revealDataDir,
  sendSmokeReport,
  startDemoStream,
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
    expect(calls).toEqual(["start_demo_stream", "window_ready", "smoke_report", "reveal_data_dir"]);
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

import { describe, expect, it, vi } from "vitest";
import type { DictationEvent } from "../bindings";
import {
  type DictationApi,
  DictationController,
  dictationBusy,
  insertDictation,
} from "./dictation";

function fixture(installed = true) {
  let receive: (event: DictationEvent) => void = () => {};
  const api: DictationApi = {
    model: vi.fn(async () => ({ installed, name: "Whisper base", bytes: 147951465 })),
    start: vi.fn(async (_id, event) => {
      receive = event;
    }),
    download: vi.fn(async (_id, event) => {
      receive = event;
    }),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
  const insert = vi.fn();
  const controller = new DictationController(api, insert);
  return { api, insert, controller, event: (event: DictationEvent) => receive(event) };
}

describe("local dictation", () => {
  it("requires a download action and never automatically records after downloading", async () => {
    const f = fixture(false);
    await f.controller.open();
    expect(f.controller.getSnapshot().state).toBe("needs_model");
    expect(f.api.download).not.toHaveBeenCalled();
    await f.controller.download();
    f.event({ state: "downloading", received: 20, total: 100 });
    expect(f.controller.getSnapshot()).toEqual({ state: "downloading", received: 20, total: 100 });
    f.event({ state: "model_ready" });
    expect(f.controller.getSnapshot().state).toBe("ready");
    expect(f.api.start).not.toHaveBeenCalled();
  });
  it("inserts one completed transcript and never exposes sending in its API", async () => {
    const f = fixture();
    await f.controller.open();
    f.event({ state: "recording", seconds: 1, level: 0.3, limit_seconds: 120 });
    await f.controller.stop();
    expect(f.api.stop).toHaveBeenCalledOnce();
    f.event({ state: "transcribing", percent: 60 });
    expect(dictationBusy(f.controller.getSnapshot())).toBe(true);
    f.event({ state: "complete", text: "  Add a test.  " });
    f.event({ state: "complete", text: "duplicate" });
    expect(f.insert).toHaveBeenCalledExactlyOnceWith("Add a test.");
    expect(f.controller.getSnapshot().state).toBe("idle");
  });
  it("discards late text after cancellation, unmount, and StrictMode remount", async () => {
    const f = fixture();
    await f.controller.open();
    await f.controller.cancel();
    f.event({ state: "complete", text: "cancelled" });
    expect(f.insert).not.toHaveBeenCalled();
    await f.controller.open();
    f.controller.dispose();
    f.controller.activate();
    f.event({ state: "complete", text: "old chat" });
    expect(f.insert).not.toHaveBeenCalled();
    await f.controller.open();
    f.event({ state: "complete", text: "current" });
    expect(f.insert).toHaveBeenCalledExactlyOnceWith("current");
  });
  it("cancels again if unmounted before the start command is admitted", async () => {
    const f = fixture();
    let admit: () => void = () => {};
    f.api.start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          admit = resolve;
        }),
    );
    const start = f.controller.start();
    f.controller.dispose();
    admit();
    await start;
    expect(f.api.cancel).toHaveBeenCalledTimes(2);
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("shows backend failures and allows retry", async () => {
    const f = fixture();
    await f.controller.open();
    f.event({ state: "failed", message: "Microphone denied" });
    expect(f.controller.getSnapshot()).toEqual({ state: "failed", message: "Microphone denied" });
    await f.controller.open();
    expect(f.api.start).toHaveBeenCalledTimes(2);
  });
  it("does not start a recording after dismissing a pending model check", async () => {
    const f = fixture();
    let ready: (value: Awaited<ReturnType<DictationApi["model"]>>) => void = () => {};
    f.api.model = () =>
      new Promise((resolve) => {
        ready = resolve;
      });
    const opening = f.controller.open();
    await f.controller.cancel();
    ready({ installed: true, name: "base", bytes: 1 });
    await opening;
    expect(f.api.start).not.toHaveBeenCalled();
  });
});

describe("dictation draft insertion", () => {
  it("inserts at the captured selection with readable spacing", () => {
    expect(insertDictation("Make this work", "the test", "Make this work", 5, 9)).toBe(
      "Make the test work",
    );
    expect(insertDictation("", " Hello ", "", 0, 0)).toBe("Hello");
  });
  it("preserves edits made while transcribing and ignores empty results", () => {
    expect(insertDictation("New draft", "Add tests", "Old draft", 0, 9)).toBe(
      "New draft Add tests",
    );
    expect(insertDictation("Keep me", "   ", "Keep me", 0, 7)).toBe("Keep me");
  });
});

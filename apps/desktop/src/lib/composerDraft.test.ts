import { describe, expect, it, vi } from "vitest";
import type { ComposerTransport } from "./composer";
import { ComposerDraftStore, composerDraft } from "./composerDraft";

function fake(): ComposerTransport {
  return {
    draft: vi.fn(async () => ({
      input: { text: "saved", attachments: [], mentions: [] },
      files: [],
    })),
    saveDraft: vi.fn(async () => {}),
    pick: vi.fn(async () => null),
    import: vi.fn(async () => ({
      id: "image",
      name: "image.png",
      bytes: 10,
      mime: "image/png",
      image: true,
    })),
    paste: vi.fn(async () => ({
      id: "image",
      name: "image.png",
      bytes: 10,
      mime: "image/png",
      image: true,
    })),
    mentions: vi.fn(async () => []),
    send: vi.fn(async () => ({ prompt_id: "prompt", queued: false })),
  };
}

describe("durable composer draft coordination", () => {
  it("clears an accepted steering draft only when the entire submitted draft still matches", async () => {
    const api = fake();
    const store = new ComposerDraftStore("chat", api);
    await Promise.resolve();
    store.update({ text: "first", mentions: ["first.rs"] });
    const sent = store.input();
    store.update({ text: "next", mentions: ["first.rs", "second.rs"] });
    store.consume(sent, true);
    expect(store.input()).toEqual({
      text: "next",
      attachments: [],
      mentions: ["first.rs", "second.rs"],
    });
    store.consume(store.input(), true);
    expect(store.input()).toEqual({ text: "", attachments: [], mentions: [] });
    await store.flush();
  });

  it("reuses a draft when its chat is reopened and flushes after the view leaves", async () => {
    const api = fake();
    const store = composerDraft("chat", api);
    await Promise.resolve();
    const close = store.subscribe(() => {});
    store.update({ text: "unsent new work", mentions: ["src/main.rs"] });
    close();
    await store.flush();
    expect(composerDraft("chat", api)).toBe(store);
    expect(api.saveDraft).toHaveBeenLastCalledWith("chat", {
      text: "unsent new work",
      attachments: [],
      mentions: ["src/main.rs"],
    });
  });

  it("serializes saves and does not replace a newer edit with an older write", async () => {
    const api = fake();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.saveDraft = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(undefined);
    const store = new ComposerDraftStore("chat", api);
    await Promise.resolve();
    store.update({ text: "first" });
    const saving = store.flush();
    store.update({ text: "second" });
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    release();
    await saving;
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.saveDraft).toHaveBeenLastCalledWith("chat", {
      text: "second",
      attachments: [],
      mentions: [],
    });
    await store.flush();
  });

  it("clears only sent context and preserves text entered while sending", async () => {
    const api = fake();
    const store = new ComposerDraftStore("chat", api);
    await Promise.resolve();
    store.update({ text: "send this", mentions: ["first.rs"] });
    const sent = store.input();
    store.update({ text: "next message", mentions: ["first.rs", "second.rs"] });
    store.consume(sent);
    await store.flush();
    expect(store.input()).toEqual({
      text: "next message",
      attachments: [],
      mentions: ["second.rs"],
    });
  });

  it("retains an unsaved draft for retry and refuses to overwrite a draft that failed to load", async () => {
    const api = fake();
    api.saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const store = new ComposerDraftStore("chat", api);
    await Promise.resolve();
    store.update({ text: "keep me" });
    await store.flush();
    expect(store.getSnapshot().error).toContain("disk full");
    expect(store.input().text).toBe("keep me");
    await store.flush();
    expect(store.getSnapshot().error).toBeNull();
    const broken = fake();
    broken.draft = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const blocked = new ComposerDraftStore("other", broken);
    await Promise.resolve();
    blocked.update({ text: "do not overwrite" });
    await blocked.flush();
    expect(blocked.getSnapshot().ready).toBe(false);
    expect(broken.saveDraft).not.toHaveBeenCalled();
  });
});

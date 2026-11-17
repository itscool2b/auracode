import { describe, expect, it, vi } from "vitest";
import { performProfileSwitch, takeSettingsReturn } from "./profiles";

describe("the page a switch made in Settings returns to", () => {
  const storage = (value: string | null) => {
    const held = new Map(value === null ? [] : [["auracode.settings-return", value]]);
    return {
      held,
      getItem: (key: string) => held.get(key) ?? null,
      removeItem: (key: string) => void held.delete(key),
    };
  };
  it("is read once, so a later reload opens the chats", () => {
    const store = storage("privacy");
    expect(takeSettingsReturn(store)).toBe("privacy");
    expect(store.held.size).toBe(0);
    expect(takeSettingsReturn(store)).toBeNull();
  });
  it("ignores anything it did not write, and storage that cannot be read", () => {
    expect(takeSettingsReturn(storage("plugins"))).toBeNull();
    // What an earlier version wrote for its Account page opens the chats.
    expect(takeSettingsReturn(storage("account"))).toBeNull();
    expect(takeSettingsReturn(storage(null))).toBeNull();
    expect(takeSettingsReturn(null)).toBeNull();
    expect(
      takeSettingsReturn({
        getItem: () => {
          throw new Error("denied");
        },
        removeItem: () => undefined,
      }),
    ).toBeNull();
  });
});

describe("profile publication", () => {
  it("waits for every draft before activating and discards the old page on success", async () => {
    const order: string[] = [];
    await performProfileSwitch(
      async () => {
        order.push("activate");
      },
      async () => {
        await Promise.resolve();
        order.push("saved");
        return true;
      },
      () => {
        order.push("reload");
      },
    );
    expect(order).toEqual(["saved", "activate", "reload"]);
  });
  it("retains the current profile when a draft is unsaved", async () => {
    const activate = vi.fn();
    const reload = vi.fn();
    await expect(performProfileSwitch(activate, async () => false, reload)).rejects.toThrow(
      "draft has not been saved",
    );
    expect(activate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it("retains the page when native preparation refuses live work or cannot open the target", async () => {
    const reload = vi.fn();
    await expect(
      performProfileSwitch(
        async () => {
          throw new Error("Finish live work");
        },
        async () => true,
        reload,
      ),
    ).rejects.toThrow("Finish live work");
    expect(reload).not.toHaveBeenCalled();
  });
});

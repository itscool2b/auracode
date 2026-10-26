import { describe, expect, it, vi } from "vitest";
import { performProfileSwitch } from "./profiles";

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
  it("retains the page when native preparation refuses live work or cannot unlock the target", async () => {
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

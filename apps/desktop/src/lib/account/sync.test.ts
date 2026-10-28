import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSyncStatus } from "./bindings";

const native = vi.hoisted(() => ({ available: true, listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../ipc", () => ({ inTauri: () => native.available }));

import { subscribeAccountSync, syncStatusLabel } from "./sync";

const status: AccountSyncStatus = {
  state: "idle",
  last_sync_at: 123,
  pending_changes: 0,
  message: null,
};
describe("Account sync event ownership", () => {
  beforeEach(() => {
    native.available = true;
    native.listen.mockReset();
  });
  it("ignores an old profile's publication and events after disposal", async () => {
    const stop = vi.fn();
    let handler: (event: { payload: [string, AccountSyncStatus] }) => void = () => {};
    native.listen.mockImplementation(async (_name, callback) => {
      handler = callback;
      return stop;
    });
    const update = vi.fn();
    const dispose = subscribeAccountSync("current", update);
    await Promise.resolve();
    handler({ payload: ["old", status] });
    expect(update).not.toHaveBeenCalled();
    handler({ payload: ["current", status] });
    expect(update).toHaveBeenCalledExactlyOnceWith(status);
    dispose();
    handler({ payload: ["current", status] });
    expect(update).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("releases a listener whose registration completes after the view leaves", async () => {
    let registered: (stop: () => void) => void = () => {};
    native.listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          registered = resolve;
        }),
    );
    const dispose = subscribeAccountSync("profile", vi.fn());
    dispose();
    const stop = vi.fn();
    registered(stop);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it("does not subscribe without a native active profile", () => {
    subscribeAccountSync(null, vi.fn())();
    native.available = false;
    subscribeAccountSync("profile", vi.fn())();
    expect(native.listen).not.toHaveBeenCalled();
  });
});

describe("syncStatusLabel", () => {
  it("does not call a never-synced or pending workspace synced", () => {
    const idle = { ...status, last_sync_at: null };
    expect(syncStatusLabel(undefined)).toBe("Sync status loading");
    expect(syncStatusLabel(null)).toBe("Sync status unavailable");
    expect(syncStatusLabel(idle)).toBe("Sync ready");
    expect(syncStatusLabel({ ...idle, last_sync_at: 100, pending_changes: 2 })).toBe(
      "2 changes pending",
    );
    expect(syncStatusLabel({ ...idle, last_sync_at: 100 })).toBe("Synced");
    expect(syncStatusLabel({ ...idle, state: "paused", pending_changes: 3 })).toBe(
      "Sync paused · 3 pending",
    );
    expect(syncStatusLabel({ ...idle, state: "offline" })).toBe("Offline");
    expect(syncStatusLabel({ ...idle, state: "inactive" })).toBe("Sync inactive");
  });
});

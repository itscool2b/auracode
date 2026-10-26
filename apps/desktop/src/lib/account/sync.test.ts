import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSyncStatus } from "./bindings";

const native = vi.hoisted(() => ({ available: true, listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../ipc", () => ({ inTauri: () => native.available }));

import { subscribeAccountSync } from "./sync";

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

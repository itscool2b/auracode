import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignInLink } from "../bindings";

const native = vi.hoisted(() => ({
  available: true,
  listen: vi.fn(),
  pending: vi.fn(),
  acknowledge: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("./ipc", () => ({ inTauri: () => native.available }));
vi.mock("../bindings", () => ({
  commands: {
    signInLinkPending: native.pending,
    signInLinkAcknowledge: native.acknowledge,
  },
}));

import { signInNavigationReady, subscribeSignInLinks } from "./signInLinks";

const link: SignInLink = { id: "1", email: "person@example.com" };
describe("Account navigation admission", () => {
  const ready = {
    profile_locked: false,
    profile_switching: false,
    config_profile_recovery: null,
    fatal: null,
    launch: { type: "normal" as const },
  };
  it("retains a startup link through loading, recovery, profile switching and modal work", () => {
    expect(signInNavigationReady(ready, false)).toBe(true);
    expect(signInNavigationReady(null, false)).toBe(false);
    expect(signInNavigationReady(ready, true)).toBe(false);
    expect(signInNavigationReady({ ...ready, profile_locked: true }, false)).toBe(false);
    expect(signInNavigationReady({ ...ready, profile_switching: true }, false)).toBe(false);
    expect(signInNavigationReady({ ...ready, fatal: "Cannot open data" }, false)).toBe(false);
    expect(
      signInNavigationReady(
        {
          ...ready,
          config_profile_recovery: {
            transaction: "pending",
            owner_profile: "owner",
            from_profile: "local",
            to_profile: "owner",
            phase: "restore_previous",
            detail: "Restore the previous configuration",
          },
        },
        false,
      ),
    ).toBe(false);
  });
});
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
describe("native Account navigation", () => {
  let wake: () => void;
  let focus: () => void;
  let stop: ReturnType<typeof vi.fn>;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    native.available = true;
    stop = vi.fn();
    native.listen.mockImplementation(async (_name, callback) => {
      wake = callback;
      return stop;
    });
    native.pending.mockResolvedValue(link);
    native.acknowledge.mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      addEventListener: (_name: string, callback: () => void) => {
        focus = callback;
      },
      removeEventListener: vi.fn(),
    });
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens once and acknowledges only accepted navigation, without authentication", async () => {
    const open = vi.fn((_link: SignInLink) => true);
    dispose = subscribeSignInLinks(open);
    await flush();
    expect(open).toHaveBeenCalledExactlyOnceWith(link);
    expect(native.acknowledge).toHaveBeenCalledExactlyOnceWith(link.id);
    focus();
    await flush();
    expect(open).toHaveBeenCalledOnce();
    native.pending.mockResolvedValue({ ...link, id: "2" });
    wake();
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("keeps a link pending while a dialog is open and retries when it closes", async () => {
    const open = vi.fn((_link: SignInLink) => false);
    dispose = subscribeSignInLinks(open);
    await flush();
    expect(native.acknowledge).not.toHaveBeenCalled();
    open.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(native.acknowledge).toHaveBeenCalledExactlyOnceWith(link.id);
  });

  it("does not consume or navigate after a StrictMode unmount during the native read", async () => {
    let resolve: (link: SignInLink) => void = () => {};
    native.pending.mockImplementation(
      () =>
        new Promise<SignInLink>((done) => {
          resolve = done;
        }),
    );
    const open = vi.fn((_link: SignInLink) => true);
    dispose = subscribeSignInLinks(open);
    await flush();
    dispose();
    resolve(link);
    await flush();
    expect(open).not.toHaveBeenCalled();
    expect(native.acknowledge).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("serializes overlapping notifications and handles the newest pending link", async () => {
    let resolve: (link: SignInLink) => void = () => {};
    native.pending.mockImplementationOnce(
      () =>
        new Promise<SignInLink>((done) => {
          resolve = done;
        }),
    );
    const open = vi.fn((_link: SignInLink) => true);
    dispose = subscribeSignInLinks(open);
    await flush();
    wake();
    focus();
    expect(native.pending).toHaveBeenCalledOnce();
    native.pending.mockResolvedValue({ ...link, id: "2" });
    resolve(link);
    await flush();
    expect(open.mock.calls.map(([value]) => value.id)).toEqual(["1", "2"]);
  });

  it("leaves browser previews outside native navigation", () => {
    native.available = false;
    dispose = subscribeSignInLinks(vi.fn());
    expect(native.listen).not.toHaveBeenCalled();
  });
});

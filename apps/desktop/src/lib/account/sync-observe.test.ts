import { describe, expect, it } from "vitest";
import type { AccountSyncStatus } from "./bindings";
import { type AccountSyncSource, observeAccountSync } from "./sync";

const idle: AccountSyncStatus = {
  state: "idle",
  pending_changes: 0,
  last_sync_at: 100,
  message: null,
};

function fake() {
  let receive: (status: AccountSyncStatus) => void = () => {};
  let ready: () => void = () => {};
  let resolve: (value: [string, AccountSyncStatus] | null) => void = () => {};
  let reject: () => void = () => {};
  let reads = 0;
  let stops = 0;
  const source: AccountSyncSource = {
    subscribe: (_id, update, subscribed) => {
      receive = update;
      ready = subscribed ?? (() => {});
      return () => {
        stops++;
      };
    },
    snapshot: () => {
      reads++;
      return new Promise((done, fail) => {
        resolve = done;
        reject = () => fail(new Error("Synthetic IPC failure"));
      });
    },
  };
  return {
    source,
    ready: () => ready(),
    receive: (value: AccountSyncStatus) => receive(value),
    resolve: (id: string) => resolve([id, idle]),
    reject: () => reject(),
    counts: () => ({ reads, stops }),
  };
}

describe("active profile sync observation", () => {
  it("waits for subscription and keeps a newer event over the cache response", async () => {
    const api = fake();
    const received: (AccountSyncStatus | null)[] = [];
    const stop = observeAccountSync("account", api.source, (value) => received.push(value));
    expect(api.counts().reads).toBe(0);
    api.ready();
    const paused: AccountSyncStatus = { ...idle, state: "paused", pending_changes: 3 };
    api.receive(paused);
    api.resolve("account");
    await Promise.resolve();
    expect(received).toEqual([paused]);
    stop();
    expect(api.counts()).toEqual({ reads: 1, stops: 1 });
  });

  it("ignores old-profile callbacks and responses after switching", async () => {
    const api = fake();
    const received: (AccountSyncStatus | null)[] = [];
    const stop = observeAccountSync("old", api.source, (value) => received.push(value));
    api.ready();
    stop();
    api.resolve("old");
    api.receive(idle);
    await Promise.resolve();
    expect(received).toEqual([]);
  });

  it("does not display the published cache of a different profile", async () => {
    const api = fake();
    const received: (AccountSyncStatus | null)[] = [];
    observeAccountSync("current", api.source, (value) => received.push(value));
    api.ready();
    api.resolve("other");
    await Promise.resolve();
    expect(received).toEqual([null]);
  });

  it("reports cache failure without masking a later native update", async () => {
    const api = fake();
    const received: (AccountSyncStatus | null)[] = [];
    observeAccountSync("account", api.source, (value) => received.push(value));
    api.ready();
    api.reject();
    await Promise.resolve();
    api.receive(idle);
    expect(received).toEqual([null, idle]);
  });
});

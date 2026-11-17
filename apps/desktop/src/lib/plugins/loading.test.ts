import { describe, expect, it } from "vitest";
import type { PluginLibrary } from "../../bindings";
import type { PluginsApi } from "./api";
import { PluginLibraryLoader } from "./loading";

function pending() {
  let resolve!: (value: PluginLibrary) => void;
  let reject!: (reason: unknown) => void;
  let update!: (value: PluginLibrary) => void;
  const result = new Promise<PluginLibrary>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const api: PluginsApi = {
    snapshot: (_refresh, onUpdate) => {
      update = onUpdate ?? (() => {});
      return result;
    },
    update: async () => {},
  };
  return { api, resolve, reject, progress: (value: PluginLibrary) => update(value) };
}

describe("Plugin library request lifetime", () => {
  it("renders each partial snapshot before the final reply", async () => {
    const loader = new PluginLibraryLoader();
    const request = pending();
    const seen: PluginLibrary[] = [];
    let done = false;
    const run = loader.load(request.api, false, {
      value: (value) => seen.push(value),
      error: () => {
        throw new Error("unexpected failure");
      },
      done: () => {
        done = true;
      },
    });
    const initial = { agents: [], notices: ["initial file inventory"] };
    const fast = { agents: [], notices: ["fast provider"] };
    request.progress(initial);
    request.progress(fast);
    expect(seen).toEqual([initial, fast]);
    expect(done).toBe(false);
    request.resolve(fast);
    await run;
    expect(done).toBe(true);
  });

  it("ignores old callbacks, failures and completion after a newer request", async () => {
    const loader = new PluginLibraryLoader();
    const older = pending();
    const newer = pending();
    const seen: string[] = [];
    const callbacks = {
      value: (value: PluginLibrary) => seen.push(value.notices[0] ?? ""),
      error: () => seen.push("error"),
      done: () => seen.push("done"),
    };
    const first = loader.load(older.api, false, callbacks);
    const second = loader.load(newer.api, true, callbacks);
    older.progress({ agents: [], notices: ["stale"] });
    older.reject(new Error("old failure"));
    await first;
    expect(seen).toEqual([]);
    newer.resolve({ agents: [], notices: ["current"] });
    await second;
    expect(seen).toEqual(["current", "done"]);
  });

  it("ignores channel updates and final replies after unmount, including StrictMode remounts", async () => {
    const loader = new PluginLibraryLoader();
    const old = pending();
    const seen: string[] = [];
    const callbacks = {
      value: () => seen.push("value"),
      error: () => seen.push("error"),
      done: () => seen.push("done"),
    };
    const first = loader.load(old.api, false, callbacks);
    loader.cancel();
    const fresh = pending();
    const second = loader.load(fresh.api, false, callbacks);
    old.progress({ agents: [], notices: [] });
    old.resolve({ agents: [], notices: [] });
    await first;
    expect(seen).toEqual([]);
    loader.cancel();
    fresh.reject(new Error("unmounted"));
    await second;
    expect(seen).toEqual([]);
  });
});

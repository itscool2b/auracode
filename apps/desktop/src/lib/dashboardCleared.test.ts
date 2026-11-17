import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../bindings";
import { DashboardCleared, parseCleared } from "./dashboardCleared";

const chat = (id: string, updated_at: number): ChatSummary => ({
  id,
  title: id,
  agent_id: "claude",
  agent_name: "Claude Code",
  folder: "/work/auracode",
  folder_state: "ok",
  status: "ready",
  needs_attention: false,
  created_at: 1,
  updated_at,
});

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("cleared Dashboard cards", () => {
  it("remember each chat's last activity on this device and drop chats that are gone", () => {
    const storage = memory();
    const store = new DashboardCleared(storage);
    const a = chat("a", 100);
    const b = chat("b", 200);
    store.clear([a, b], [a, b]);
    expect(store.isCleared(a)).toBe(true);
    expect(store.isCleared({ ...a, updated_at: 101 })).toBe(false);
    // "b" was deleted; clearing "c" later forgets it.
    const c = chat("c", 300);
    store.clear([c], [a, c]);
    expect(JSON.parse(storage.items.get("auracode.dashboard-cleared") ?? "{}")).toEqual({
      c: 300,
      a: 100,
    });
    // The next run reads the same list.
    expect(new DashboardCleared(storage).isCleared(c)).toBe(true);
  });

  it("reads nothing malformed", () => {
    expect(parseCleared(null).size).toBe(0);
    expect(parseCleared("{").size).toBe(0);
    expect(parseCleared("[1,2]").size).toBe(0);
    expect([...parseCleared('{"a":5,"b":"x","c":null}')]).toEqual([["a", 5]]);
  });

  it("keeps working when storage is blocked", () => {
    const store = new DashboardCleared({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    const a = chat("a", 1);
    store.clear([a], [a]);
    expect(store.isCleared(a)).toBe(true);
  });
});

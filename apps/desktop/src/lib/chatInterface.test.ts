import { describe, expect, it, vi } from "vitest";
import { ChatInterfaces, type InterfaceStorage } from "./chatInterface";

function memory(): InterfaceStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("a chat's interface", () => {
  it("is Chat until Terminal is chosen, and only for agents with a terminal", () => {
    const interfaces = new ChatInterfaces(memory());
    expect(interfaces.of("c1", "claude")).toBe("chat");
    interfaces.set("c1", "terminal");
    expect(interfaces.of("c1", "claude")).toBe("terminal");
    // The same chat switched to an agent without a terminal shows as Chat.
    expect(interfaces.of("c1", "mock")).toBe("chat");
    // Every agent with an interface of its own opens there, also under a connection's ID.
    for (const agent of ["grok", "opencode", "hermes", "pi", "omp", "cursor", "antigravity"]) {
      expect(interfaces.of("c1", agent)).toBe("terminal");
    }
    expect(interfaces.of("c1", "claude-acp")).toBe("terminal");
    interfaces.set("c1", "chat");
    expect(interfaces.of("c1", "claude")).toBe("chat");
  });

  it("stores nothing for Chat, and tells its listeners of each change", () => {
    const storage = memory();
    const interfaces = new ChatInterfaces(storage);
    const listener = vi.fn();
    interfaces.subscribe(listener);
    interfaces.set("c1", "terminal");
    interfaces.set("c1", "chat");
    expect(storage.items.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(interfaces.getVersion()).toBe(2);
  });

  it("keeps a default for new chats", () => {
    const interfaces = new ChatInterfaces(memory());
    expect(interfaces.defaultInterface()).toBe("chat");
    interfaces.setDefault("terminal");
    expect(interfaces.defaultInterface()).toBe("terminal");
  });

  it("falls back to Chat when storage fails", () => {
    const broken: InterfaceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    };
    const interfaces = new ChatInterfaces(broken);
    expect(() => interfaces.set("c1", "terminal")).not.toThrow();
    expect(interfaces.of("c1", "claude")).toBe("chat");
    expect(new ChatInterfaces(null).of("c1", "claude")).toBe("chat");
  });
});

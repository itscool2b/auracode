import { describe, expect, it, vi } from "vitest";
import { FileResolver } from "./fileLinks";

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe("which names are a chat's files", () => {
  it("checks the names a frame asks about in one call, each once", async () => {
    const check = vi.fn(async (_chat: string, references: readonly string[]) =>
      references.map((reference) => (reference.endsWith(".ts") ? `src/${reference}` : null)),
    );
    const resolver = new FileResolver("chat-1", { check });
    const heard = vi.fn();
    resolver.subscribe(heard);
    resolver.request("a.ts");
    resolver.request("b.md");
    resolver.request("a.ts");
    expect(resolver.peek("a.ts")).toBeUndefined();
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith("chat-1", ["a.ts", "b.md"]);
    expect(resolver.peek("a.ts")).toBe("src/a.ts");
    expect(resolver.peek("b.md")).toBeNull();
    expect(heard).toHaveBeenCalled();
    // A known name is never asked about again.
    resolver.request("a.ts");
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("asks again about names that were not files once a turn may have written them", async () => {
    let written = false;
    const check = vi.fn(async (_chat: string, references: readonly string[]) =>
      references.map((reference) => (written ? reference : null)),
    );
    const resolver = new FileResolver("chat-1", { check });
    resolver.request("new.ts");
    await settle();
    expect(resolver.peek("new.ts")).toBeNull();
    written = true;
    const before = resolver.snapshot();
    resolver.refresh();
    expect(resolver.snapshot()).toBeGreaterThan(before);
    expect(resolver.peek("new.ts")).toBeUndefined();
    resolver.request("new.ts");
    await settle();
    expect(resolver.peek("new.ts")).toBe("new.ts");
  });

  it("links nothing when a check fails, and splits more than 200 names into batches", async () => {
    const failing = new FileResolver("chat-1", {
      check: async () => {
        throw new Error("The chat's files could not be checked.");
      },
    });
    failing.request("a.ts");
    await settle();
    expect(failing.peek("a.ts")).toBeNull();
    const sizes: number[] = [];
    const resolver = new FileResolver("chat-1", {
      check: async (_chat, references) => {
        sizes.push(references.length);
        return references.map(() => null);
      },
    });
    for (let index = 0; index < 250; index++) resolver.request(`f${index}.ts`);
    await settle();
    await settle();
    expect(sizes).toEqual([200, 50]);
  });
});

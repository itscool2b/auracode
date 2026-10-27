import { describe, expect, it, vi } from "vitest";
import type { TerminalChunk } from "../bindings";
import { TerminalSession, type TerminalTransport } from "./terminal";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fake(): TerminalTransport {
  return {
    reserve: vi.fn(async () => "terminal"),
    start: vi.fn(async (id) => id),
    read: vi.fn(async () => ({ bytes: [], done: true, exit_code: 0, truncated: false })),
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}
const size = { rows: 24, cols: 80 };

describe("terminal flow control and ownership", () => {
  it("does not start after the sheet closes while reserving", async () => {
    const reserve = deferred<string>();
    const transport = fake();
    transport.reserve = () => reserve.promise;
    const session = new TerminalSession(transport, async () => {}, vi.fn());
    const start = session.start("claude", size);
    await session.close();
    reserve.resolve("late");
    await start;
    expect(transport.start).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledWith("late");
  });

  it("closes an allocated terminal while start is pending and never pulls its output", async () => {
    const starting = deferred<string>();
    const transport = fake();
    transport.start = vi.fn(() => starting.promise);
    const session = new TerminalSession(transport, async () => {}, vi.fn());
    const start = session.start("claude", size);
    await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce());
    await session.close();
    expect(transport.close).toHaveBeenCalledWith("terminal");
    starting.resolve("terminal");
    await start;
    expect(transport.read).not.toHaveBeenCalled();
  });

  it("waits for rendering before the next read and reports actual exit status", async () => {
    const painted = deferred<void>();
    const transport = fake();
    transport.read = vi
      .fn()
      .mockResolvedValueOnce({ bytes: [65], done: false, exit_code: null, truncated: false })
      .mockResolvedValueOnce({ bytes: [], done: true, exit_code: 7, truncated: true });
    const changed = vi.fn();
    const render = vi.fn(() => painted.promise);
    const session = new TerminalSession(transport, render, changed);
    const start = session.start("codex", size);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(transport.read).toHaveBeenCalledOnce();
    painted.resolve();
    await start;
    expect(changed).toHaveBeenLastCalledWith({ state: "finished", exitCode: 7, truncated: true });
    expect(transport.close).toHaveBeenCalledWith("terminal");
  });

  it("serializes bounded input, closes pending reads and does not duplicate start", async () => {
    const chunk = deferred<TerminalChunk>();
    const transport = fake();
    transport.read = vi.fn(() => chunk.promise);
    const session = new TerminalSession(transport, async () => {}, vi.fn());
    const start = session.start("codex", size);
    await session.start("codex", size);
    await vi.waitFor(() => expect(transport.read).toHaveBeenCalledOnce());
    session.write(new Uint8Array(20_000).fill(65));
    session.write(Uint8Array.from([66]));
    await vi.waitFor(() => expect(transport.write).toHaveBeenCalledTimes(3));
    expect(vi.mocked(transport.write).mock.calls.map(([, bytes]) => bytes.length)).toEqual([
      16_384, 3616, 1,
    ]);
    expect(transport.start).toHaveBeenCalledOnce();
    await session.close();
    chunk.resolve({ bytes: [67], done: true, exit_code: 0, truncated: false });
    await start;
  });
});

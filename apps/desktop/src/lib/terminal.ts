import type { TerminalChunk } from "../bindings";
import { errorMessage } from "./errors";
import {
  agentLoginStart,
  terminalClose,
  terminalRead,
  terminalReserve,
  terminalResize,
  terminalWrite,
} from "./ipc";

export interface TerminalSize {
  rows: number;
  cols: number;
}
export interface TerminalTransport {
  reserve(): Promise<string>;
  start(id: string, agentId: string, size: TerminalSize): Promise<string>;
  read(id: string): Promise<TerminalChunk>;
  write(id: string, bytes: number[]): Promise<void>;
  resize(id: string, size: TerminalSize): Promise<void>;
  close(id: string): Promise<void>;
}
export const terminalTransport: TerminalTransport = {
  reserve: terminalReserve,
  start: (id, agentId, size) => agentLoginStart(id, agentId, size.rows, size.cols),
  read: terminalRead,
  write: terminalWrite,
  resize: (id, size) => terminalResize(id, size.rows, size.cols),
  close: terminalClose,
};

export type TerminalState =
  | { state: "starting" }
  | { state: "running" }
  | { state: "finished"; exitCode: number | null; truncated: boolean }
  | { state: "failed"; message: string };

/** Renderer plumbing only. Rust chooses the program and owns all process/auth decisions. Reads
 * wait for the renderer's completion callback, so IPC never builds an unbounded output backlog. */
export class TerminalSession {
  #id: string | null = null;
  #started = false;
  #running = false;
  #closed = false;
  #input = Promise.resolve();
  #queuedInput = 0;
  #size: TerminalSize | null = null;
  #resizing = false;
  #resolveClosed: () => void = () => {};
  #closedSignal = new Promise<void>((resolve) => {
    this.#resolveClosed = resolve;
  });

  constructor(
    private readonly transport: TerminalTransport,
    private readonly render: (bytes: Uint8Array) => Promise<void>,
    private readonly changed: (state: TerminalState) => void,
  ) {}

  async start(agentId: string, size: TerminalSize): Promise<void> {
    if (this.#started || this.#closed) return;
    this.#started = true;
    this.changed({ state: "starting" });
    try {
      const id = await this.transport.reserve();
      if (this.#closed) {
        await this.transport.close(id);
        return;
      }
      this.#id = id;
      await this.transport.start(id, agentId, size);
      if (this.#closed) {
        await this.transport.close(id);
        return;
      }
      this.#running = true;
      this.changed({ state: "running" });
      if (this.#size !== null) await this.resize(this.#size);
      while (!this.#closed) {
        const chunk = await Promise.race([
          this.transport.read(id),
          this.#closedSignal.then(() => null),
        ]);
        if (this.#closed || chunk === null) return;
        if (chunk.bytes.length > 0) {
          await Promise.race([this.render(Uint8Array.from(chunk.bytes)), this.#closedSignal]);
        }
        if (this.#closed) return;
        if (chunk.done) {
          this.changed({
            state: "finished",
            exitCode: chunk.exit_code,
            truncated: chunk.truncated,
          });
          await this.close();
        }
      }
    } catch (error) {
      if (!this.#closed) this.changed({ state: "failed", message: message(error) });
      await this.close();
    }
  }

  /** Preserve event order, cap browser-side input, and bound each IPC write to Rust's limit. */
  write(bytes: Uint8Array): void {
    if (this.#closed || !this.#running || this.#id === null) return;
    if (bytes.length + this.#queuedInput > 64 * 1024) {
      this.changed({
        state: "failed",
        message: "Terminal input exceeded 64 KiB. Reopen the terminal and paste less at once.",
      });
      void this.close();
      return;
    }
    this.#queuedInput += bytes.length;
    this.#input = this.#input.then(async () => {
      try {
        for (let offset = 0; offset < bytes.length && !this.#closed; offset += 16 * 1024) {
          const id = this.#id;
          if (id === null) break;
          await this.transport.write(id, Array.from(bytes.subarray(offset, offset + 16 * 1024)));
        }
      } catch (error) {
        if (!this.#closed) this.changed({ state: "failed", message: message(error) });
        await this.close();
      } finally {
        this.#queuedInput -= bytes.length;
      }
    });
  }

  async resize(size: TerminalSize): Promise<void> {
    this.#size = size;
    if (this.#resizing || this.#closed || !this.#running || this.#id === null) return;
    this.#resizing = true;
    try {
      while (this.#size !== null && !this.#closed && this.#id !== null) {
        const next = this.#size;
        this.#size = null;
        await this.transport.resize(this.#id, next);
      }
    } catch (error) {
      if (!this.#closed) this.changed({ state: "failed", message: message(error) });
      await this.close();
    } finally {
      this.#resizing = false;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#running = false;
    this.#resolveClosed();
    const id = this.#id;
    this.#id = null;
    if (id !== null) {
      try {
        await this.transport.close(id);
      } catch {
        /* Reload/exit may already have closed it. */
      }
    }
  }
}

function message(error: unknown): string {
  return errorMessage(error, "The terminal could not continue.");
}

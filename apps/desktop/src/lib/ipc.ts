import { Channel } from "@tauri-apps/api/core";
import {
  type AppError,
  type AppErrorCode,
  type AppInfo,
  commands,
  type DemoKind,
  type EventBatch,
  type SmokeReport,
} from "../bindings";

/**
 * Thin typed wrappers over the generated bindings: results become values or thrown
 * `CommandError`s, and the stream channel becomes a callback. Components call these, never
 * `invoke` with string command names.
 */

/** `CommandError.code` when Tauri refused the call before any command ran. */
export const IPC_REJECTED = "ipc_rejected";

/** Shown when a rejection carries no message at all. */
const NO_REASON = "The app's shell refused the request without giving a reason.";

export class CommandError extends Error {
  /** The shell's stable code, or `ipc_rejected` for a call Tauri refused (see `toCommandError`). */
  readonly code: AppErrorCode | typeof IPC_REJECTED;

  constructor(code: AppErrorCode | typeof IPC_REJECTED, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/**
 * The error to throw for a failed call. A command's own failure arrives as its `AppError`
 * (`{ code, message }`). When Tauri refuses a call before the command runs (arguments that do not
 * deserialize, a permission the window lacks, state that is not managed) it rejects with a plain
 * string instead. The generated bindings pass both on as "the error" typed `AppError`, so this
 * checks the shape rather than trusting the type, and keeps Tauri's message either way.
 */
export function toCommandError(rejection: unknown): CommandError {
  if (rejection instanceof CommandError) return rejection;
  if (isAppError(rejection)) {
    return new CommandError(rejection.code, rejection.message || NO_REASON);
  }
  if (rejection instanceof Error) {
    return new CommandError(IPC_REJECTED, rejection.message || NO_REASON);
  }
  if (typeof rejection === "string" && rejection.trim() !== "") {
    return new CommandError(IPC_REJECTED, rejection);
  }
  return new CommandError(IPC_REJECTED, NO_REASON);
}

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** A fallible command: its value, or a thrown `CommandError`. */
async function settle<T>(call: Promise<CommandResult<T>>): Promise<T> {
  let result: CommandResult<T>;
  try {
    result = await call;
  } catch (error) {
    // The bindings rethrow `Error`s (no IPC at all, for one) instead of returning them.
    throw toCommandError(error);
  }
  if (result.status === "error") throw toCommandError(result.error);
  return result.data;
}

/** A command that cannot fail by itself: Tauri can still refuse the call. */
async function infallible<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw toCommandError(error);
  }
}

/** Whether the page runs inside the Tauri shell (rather than a plain browser on the dev server). */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getAppInfo(): Promise<AppInfo> {
  return infallible(commands.appInfo());
}

/**
 * Starts a demo stream; `onBatch` receives every frame, in order. Resolves with the session id
 * once the shell has accepted the stream (frames may arrive before that).
 */
export async function startDemoStream(
  kind: DemoKind,
  tokensPerSec: number,
  onBatch: (batch: EventBatch) => void,
): Promise<string> {
  // Inside the async function, so a missing IPC bridge rejects instead of throwing synchronously.
  const channel = new Channel<EventBatch>();
  channel.onmessage = onBatch;
  return settle(commands.startDemoStream(kind, Math.round(tokensPerSec), channel));
}

export function cancelDemoStream(sessionId: string): Promise<void> {
  return infallible(commands.cancelDemoStream(sessionId));
}

export async function windowReady(): Promise<void> {
  await settle(commands.windowReady());
}

export async function sendSmokeReport(report: SmokeReport): Promise<void> {
  await settle(commands.smokeReport(report));
}

/**
 * Shows the data folder selected in the system file manager. The shell decides which folder:
 * the page cannot name a path to reveal.
 */
export async function revealDataDir(): Promise<void> {
  await settle(commands.revealDataDir());
}

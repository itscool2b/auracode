import type { HoldCause, QueueWait } from "../../bindings";

/** The one thing a person can do about a wait, when there is one. */
export type QueueAction =
  /** Moves the next message ahead now: interrupts the running turn, or stops waiting for idle. */
  | "send_now"
  /**
   * The held message everything waits behind: Send it now, or Discard (and Send all when more
   * than one is held). A held message never goes on its own.
   */
  | "send_held"
  /** Starts the agent again after a failed start, or starts a stopped one. */
  | "start"
  /** Recreates this chat's missing worktree folder. */
  | "recreate"
  | "setup";

export interface QueueWaitView {
  readonly reason: QueueWait["reason"];
  /** Why the next message waits, in plain words. */
  readonly text: string;
  /** More about it, for the head's tooltip. */
  readonly detail: string | null;
  readonly action: QueueAction | null;
  /** A failure the person has to clear (drawn red), rather than a wait that passes. */
  readonly failed: boolean;
}

export interface QueueWaitContext {
  /** The agent can interrupt a running turn (its capabilities say so, or are not known yet). */
  readonly canInterrupt: boolean;
  /** The missing folder is this chat's own worktree, which Recreate folder can bring back. */
  readonly canRecreate: boolean;
}

function heldText(after: HoldCause, agent: string): string {
  switch (after) {
    case "restart":
      return "Held after a restart";
    case "stop":
      return `Held after you stopped ${agent}`;
    case "error":
      return "Held after an error";
    case "sign_in":
      return `Held until you sign in to ${agent}`;
    case "workspace_removed":
      return "Held while this project or folder is removed";
    case "usage_limit":
      return `Held at ${agent}'s usage limit`;
  }
}

/**
 * Why the queued messages wait, in the words the queue and the composer show, with the one action
 * that helps. `null` when nothing waits (or the session has not said why yet).
 */
export function queueWaitView(
  wait: QueueWait | null | undefined,
  agent: string,
  context: QueueWaitContext,
): QueueWaitView | null {
  if (!wait) return null;
  const view = (
    text: string,
    action: QueueAction | null = null,
    detail: string | null = null,
    failed = false,
  ): QueueWaitView => ({ reason: wait.reason, text, detail, action, failed });
  switch (wait.reason) {
    case "setup": {
      const failed = wait.state === "failed" || wait.state === "interrupted";
      return view(
        failed
          ? (wait.detail ?? "Setup failed. Retry setup above.")
          : wait.state === "running"
            ? "Setup is running"
            : "Waiting for setup review",
        failed ? "setup" : null,
        "Your messages stay queued until setup succeeds.",
        failed,
      );
    }
    case "starting":
      return view(`Starting ${agent}`, null, "Your message goes as soon as it is ready.");
    case "working":
      return view(
        `${agent} is still working`,
        context.canInterrupt ? "send_now" : null,
        context.canInterrupt
          ? "Send now stops the current turn and sends the next message."
          : "Your message goes when this turn ends.",
      );
    case "finishing_turn":
      return view(
        `Waiting for ${agent} to finish its turn`,
        "send_now",
        `${agent} still reports work after its reply (a hook or a background task). The next message goes on its own within a few seconds, or now with Send now.`,
      );
    case "needs_answer":
      return view(
        wait.question ? `Answer ${agent}'s question first` : "Answer the permission request first",
      );
    case "saving_checkpoint":
      return view("Saving a checkpoint before sending", null, "Your message goes right after.");
    case "stopping":
      return view("Stopping the current turn", null, "The next message goes once it has stopped.");
    case "chat_changing":
      return view("Waiting for a change to this chat to finish");
    case "start_failed":
      return view(`${agent} could not start`, "start", "The error above says why.", true);
    case "sign_in":
      return view(`Sign in to ${agent} first`, null, null, true);
    case "stopped":
      return view(`${agent} is stopped`, "start");
    case "folder_missing":
      return view(
        context.canRecreate ? "This worktree's folder is missing" : "This chat's folder is missing",
        context.canRecreate ? "recreate" : null,
        context.canRecreate
          ? "Recreate folder brings the worktree back on its branch."
          : "Put the folder back to continue.",
        true,
      );
    case "workspace_removed":
      return view(
        "This project or folder was removed",
        null,
        "Restore it from Removed projects and folders to continue.",
        true,
      );
    case "held":
      return view(
        heldText(wait.after, agent),
        "send_held",
        "A held message waits for you, and every message after it waits behind it. Send it now, or discard it.",
      );
  }
}

/** The composer's placeholder: what Enter does now, in words. */
export function composerPlaceholder(status: string, agent: string): string {
  if (status === "starting") return `Message ${agent}. It goes once ${agent} has started`;
  if (status === "running") return `Queue a message for ${agent}`;
  return `Message ${agent}`;
}

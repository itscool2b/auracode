import { describe, expect, it } from "vitest";
import type { QueueWait } from "../../bindings";
import { composerPlaceholder, queueWaitView } from "./queueWait";

const CAN = { canInterrupt: true, canRecreate: false };

function said(wait: QueueWait, context = CAN) {
  const view = queueWaitView(wait, "Claude Code", context);
  return view && { text: view.text, action: view.action, failed: view.failed };
}

describe("why queued messages wait, in words", () => {
  it("names every reason plainly with the one action that helps", () => {
    expect(said({ reason: "starting" })).toEqual({
      text: "Starting Claude Code",
      action: null,
      failed: false,
    });
    expect(said({ reason: "working" })).toEqual({
      text: "Claude Code is still working",
      action: "send_now",
      failed: false,
    });
    expect(said({ reason: "finishing_turn", since: 1, sends_at: 15_001 })).toEqual({
      text: "Waiting for Claude Code to finish its turn",
      action: "send_now",
      failed: false,
    });
    expect(said({ reason: "needs_answer", question: false })?.text).toBe(
      "Answer the permission request first",
    );
    expect(said({ reason: "needs_answer", question: true })?.text).toBe(
      "Answer Claude Code's question first",
    );
    expect(said({ reason: "saving_checkpoint" })?.text).toBe("Saving a checkpoint before sending");
    expect(said({ reason: "stopping" })?.text).toBe("Stopping the current turn");
    expect(said({ reason: "chat_changing" })?.text).toBe(
      "Waiting for a change to this chat to finish",
    );
    expect(said({ reason: "start_failed" })).toEqual({
      text: "Claude Code could not start",
      action: "start",
      failed: true,
    });
    expect(said({ reason: "sign_in" })).toEqual({
      text: "Sign in to Claude Code first",
      action: null,
      failed: true,
    });
    expect(said({ reason: "stopped" })).toEqual({
      text: "Claude Code is stopped",
      action: "start",
      failed: false,
    });
    expect(said({ reason: "workspace_removed" })?.text).toBe("This project or folder was removed");
  });

  it("says what held the messages, and offers to send them", () => {
    const held = (after: Extract<QueueWait, { reason: "held" }>["after"]) =>
      said({ reason: "held", after });
    expect(held("restart")).toEqual({
      text: "Held after a restart",
      action: "send_held",
      failed: false,
    });
    expect(held("stop")?.text).toBe("Held after you stopped Claude Code");
    expect(held("error")?.text).toBe("Held after an error");
    expect(held("sign_in")?.text).toBe("Held until you sign in to Claude Code");
    expect(held("workspace_removed")?.text).toBe("Held while this project or folder is removed");
  });

  it("offers Send now only to an agent that can interrupt, Recreate only for its own worktree", () => {
    expect(said({ reason: "working" }, { canInterrupt: false, canRecreate: false })?.action).toBe(
      null,
    );
    expect(said({ reason: "folder_missing" })).toEqual({
      text: "This chat's folder is missing",
      action: null,
      failed: true,
    });
    expect(said({ reason: "folder_missing" }, { canInterrupt: true, canRecreate: true })).toEqual({
      text: "This worktree's folder is missing",
      action: "recreate",
      failed: true,
    });
    expect(queueWaitView(null, "Claude Code", CAN)).toBeNull();
    expect(queueWaitView(undefined, "Claude Code", CAN)).toBeNull();
  });

  it("never uses an em dash", () => {
    const reasons: QueueWait[] = [
      { reason: "starting" },
      { reason: "working" },
      { reason: "finishing_turn", since: null, sends_at: null },
      { reason: "needs_answer", question: true },
      { reason: "saving_checkpoint" },
      { reason: "stopping" },
      { reason: "chat_changing" },
      { reason: "start_failed" },
      { reason: "sign_in" },
      { reason: "stopped" },
      { reason: "folder_missing" },
      { reason: "workspace_removed" },
      { reason: "held", after: "stop" },
    ];
    const emDash = String.fromCharCode(0x2014);
    for (const wait of reasons) {
      const view = queueWaitView(wait, "Grok Build", CAN);
      expect(`${view?.text} ${view?.detail ?? ""}`.includes(emDash)).toBe(false);
    }
  });

  it("tells the composer a message sent while the agent starts goes once it has started", () => {
    expect(composerPlaceholder("starting", "Grok Build")).toBe(
      "Message Grok Build. It goes once Grok Build has started",
    );
    expect(composerPlaceholder("running", "Grok Build")).toBe("Queue a message for Grok Build");
    expect(composerPlaceholder("ready", "Grok Build")).toBe("Message Grok Build");
  });
});

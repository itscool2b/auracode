import { describe, expect, it } from "vitest";
import type { AuraEvent, SessionStatus } from "../../bindings";
import { chatActivity, hasLiveLine } from "./activity";
import { type ChatState, ChatStore } from "./chatStore";
import { ev, FakeTransport, numbered, sessionInfo } from "./testing";
import { applyEntries, emptyTranscript, renderTranscript } from "./transcript";

function state(events: AuraEvent[], status: SessionStatus = "running"): ChatState {
  return {
    ...new ChatStore("c", new FakeTransport()).getSnapshot(),
    session: sessionInfo({ status }),
    transcript: applyEntries(
      emptyTranscript(),
      numbered(events.map((event) => [null, event] as const)),
    ),
  };
}

describe("live chat protocol state", () => {
  it("shows real thinking, streaming and tools, including withheld thinking text", () => {
    expect(chatActivity(state([ev.turnStarted("t"), ev.thought("a", "")]))).toBe("thinking");
    expect(chatActivity(state([ev.turnStarted("t"), ev.message("a", "Hello")]))).toBe("streaming");
    expect(chatActivity(state([ev.turnStarted("t"), ev.toolCall("read")]))).toBe("tool");
  });

  it("gives pending requests priority and removes their attention while an answer is being sent", () => {
    const pending = state([ev.turnStarted("t"), ev.toolCall("read"), ev.permission("p")]);
    expect(chatActivity(pending)).toBe("waiting");
    expect(
      chatActivity({
        ...pending,
        requests: new Map([["p", { busy: true, gone: false, error: null }]]),
      }),
    ).toBe("tool");
    expect(chatActivity(state([ev.turnStarted("t"), ev.question("q")]))).toBe("waiting");
  });

  it("does not animate stale incomplete history after a stop", () => {
    const events = [ev.turnStarted("t"), ev.thought("a", "partial")];
    expect(chatActivity(state(events, "stopped"))).toBe("idle");
    expect(chatActivity(state(events, "ready"))).toBe("idle");
    expect(chatActivity(state(events, "failed"))).toBe("error");
    expect(chatActivity(state(events, "auth_required"))).toBe("waiting");
  });

  it("keeps informational notifications out of waiting activity before and after an answer", () => {
    const events: AuraEvent[] = [
      ev.turnStarted("t"),
      ev.toolCall("read"),
      {
        type: "ui_request",
        request_id: "notice",
        prompt: { type: "notify", message: "Checking the workspace" },
      },
    ];
    expect(chatActivity(state(events))).toBe("tool");
    events.push(ev.question("q"));
    expect(chatActivity(state(events))).toBe("waiting");
    events.push(ev.questionResolved("q", { type: "select", index: 0 }));
    const answered = state(events);
    expect(chatActivity(answered)).toBe("tool");
    const notice = answered.transcript.items.get("question:notice");
    expect(notice?.kind === "question" && notice.resolution).toBeNull();
  });

  it("keeps native background work active without reviving an ended thought", () => {
    expect(chatActivity(state([]))).toBe("thinking");
    const ended = state([ev.turnStarted("t"), ev.thought("a", "partial"), ev.turnEnded("t")]);
    expect(chatActivity(ended)).toBe("thinking");
    expect(hasLiveLine(renderTranscript(ended.transcript, true).at(-1))).toBe(false);
    const completed = state([
      ev.turnStarted("t"),
      ev.message("a", "Done"),
      ev.messageDone("a"),
      ev.turnEnded("t"),
    ]);
    expect(chatActivity(completed)).toBe("thinking");
  });

  it("does not add a second live row beside a stream or running tool", () => {
    const running = state([ev.turnStarted("t"), ev.toolCall("a")]);
    expect(hasLiveLine(renderTranscript(running.transcript, true).at(-1))).toBe(true);
    const done = state([
      ev.turnStarted("t"),
      ev.toolCall("a"),
      ev.toolUpdate("a", { status: "completed" }),
    ]);
    expect(hasLiveLine(renderTranscript(done.transcript, true).at(-1))).toBe(false);
  });

  it("does not revive a cancelled tool while the native process finishes background work", () => {
    for (const reason of ["cancelled", "interrupted", "error"] as const) {
      const ended = state([ev.turnStarted("t"), ev.toolCall("a"), ev.turnEnded("t", reason)]);
      expect(chatActivity(ended)).toBe("thinking");
      expect(hasLiveLine(renderTranscript(ended.transcript, true).at(-1))).toBe(false);
    }
    expect(chatActivity(state([ev.turnStarted("t"), ev.toolCall("a"), ev.turnEnded("t")]))).toBe(
      "tool",
    );
  });
});

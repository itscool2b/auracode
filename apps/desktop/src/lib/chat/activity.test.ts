import { describe, expect, it } from "vitest";
import type { O7Event, SessionStatus } from "../../bindings";
import { chatActivity, lastToolKind, streamingText } from "./activity";
import { type ChatState, ChatStore } from "./chatStore";
import { ev, FakeTransport, numbered, sessionInfo } from "./testing";
import { applyEntries, emptyTranscript, renderTranscript } from "./transcript";

function state(events: O7Event[], status: SessionStatus = "running"): ChatState {
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
    const events: O7Event[] = [
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
    expect(streamingText(renderTranscript(ended.transcript, true).at(-1))).toBe(false);
    const completed = state([
      ev.turnStarted("t"),
      ev.message("a", "Done"),
      ev.messageDone("a"),
      ev.turnEnded("t"),
    ]);
    expect(chatActivity(completed)).toBe("thinking");
  });

  it("steps the working line aside only while the newest shown output is streaming text", () => {
    const shown = (events: O7Event[]) => renderTranscript(state(events).transcript, true).at(-1);
    const answer = [ev.turnStarted("t"), ev.message("a", "Hel")];
    expect(streamingText(shown(answer))).toBe(true);
    expect(streamingText(shown([...answer, ev.messageDone("a")]))).toBe(false);
    // A call after the text brings the line back.
    expect(streamingText(shown([...answer, ev.toolCall("b")]))).toBe(false);
    // Reasoning streaming in is the live part too: its Thinking row stands in for the line.
    const thinking = [...answer, ev.messageDone("a"), ev.thought("th", "Hmm")];
    expect(streamingText(shown(thinking))).toBe(true);
    expect(streamingText(shown([...thinking, ev.thoughtDone("th", 1200)]))).toBe(false);
    expect(streamingText(shown([...answer, ev.turnEnded("t")]))).toBe(false);
  });

  it("leans the working line towards the turn's latest call, across thoughts", () => {
    const shown = (events: O7Event[]) => renderTranscript(state(events).transcript, true).at(-1);
    expect(lastToolKind(shown([ev.turnStarted("t"), ev.thought("th", "Hmm")]))).toBeNull();
    expect(
      lastToolKind(
        shown([
          ev.turnStarted("t"),
          ev.toolCall("a", { kind: "read" }),
          ev.thought("th", "Now run it"),
          ev.toolCall("b", { kind: "execute" }),
          ev.message("m", "Running the tests."),
        ]),
      ),
    ).toBe("execute");
  });

  it("does not revive a cancelled tool while the native process finishes background work", () => {
    for (const reason of ["cancelled", "interrupted", "error"] as const) {
      const ended = state([ev.turnStarted("t"), ev.toolCall("a"), ev.turnEnded("t", reason)]);
      expect(chatActivity(ended)).toBe("thinking");
      expect(streamingText(renderTranscript(ended.transcript, true).at(-1))).toBe(false);
    }
    expect(chatActivity(state([ev.turnStarted("t"), ev.toolCall("a"), ev.turnEnded("t")]))).toBe(
      "tool",
    );
  });
});

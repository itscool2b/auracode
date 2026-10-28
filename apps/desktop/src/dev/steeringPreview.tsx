/** Browser-only steering fixture. It never invokes the native transport or starts an agent. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuraEvent, Capabilities, EventBatch, SessionStatus, SteeringAck } from "../bindings";
import { ChatView } from "../components/chat/ChatView";
import {
  attachResult,
  chatSummary,
  ev,
  FakeTransport,
  frame,
  historyPage,
  items,
  lists,
  numbered,
  sessionInfo,
} from "../lib/chat/testing";
import { withPreviewContext } from "./previewContext";

function Preview() {
  const [fixture] = useState(() => {
    const scenario = new URLSearchParams(location.search).get("case");
    let status: SessionStatus = scenario === "idle" ? "ready" : "running";
    let turn: string | null =
      scenario === "unknown-turn" || scenario === "idle" ? null : "fixture-turn";
    const chat = chatSummary("steering-chat", { agent_id: "codex", agent_name: "Codex", status });
    const events: AuraEvent[] = [
      ev.turnStarted("fixture-turn"),
      ev.user("original", "Review this change"),
    ];
    if (scenario === "idle") events.push(ev.turnEnded("fixture-turn"));
    if (scenario === "remote-history") {
      events.push(ev.turnEnded("fixture-turn"));
      status = "stopped";
      turn = null;
    }
    if (scenario === "missing-native") {
      events.push(
        ev.turnEnded("fixture-turn"),
        ev.error("agent_exited", "The saved native transcript is unavailable."),
      );
      status = "failed";
      turn = null;
    }
    if (scenario === "recovered") {
      events.push(
        { type: "steering_status", message_id: "recovered-steer", state: "pending", detail: null },
        ev.user("recovered-steer", "Keep this visible after recovery"),
        ev.turnEnded("fixture-turn", "interrupted", { recovered: true }),
      );
      status = "stopped";
      turn = null;
    }
    let receive: ((batch: EventBatch) => void) | null = null;
    let pending: ((value: SteeringAck) => void) | null = null;
    let message = "";
    const calls = { steer: 0, send: 0, expected: "" };
    const recovery = { starts: 0, previews: [] as string[], applied: 0 };
    const publish = (updates: AuraEvent[]) => {
      const seq = events.length;
      events.push(...updates);
      receive?.(frame(chat.id, seq, updates));
    };
    const capabilities: Capabilities = {
      steer: scenario !== "unsupported",
      images: true,
      interrupt: true,
      resume: true,
      fork: false,
      rewind: false,
      set_model: false,
      set_effort: false,
      permissions: false,
      plans: false,
      usage: false,
      limits: false,
      slash_commands: false,
      add_dirs: false,
      autonomy_levels: ["full_auto"],
    };
    const transport = withPreviewContext(
      new FakeTransport({
        lists: async () => lists(1, { capabilities }),
        start: async () => {
          recovery.starts++;
        },
        attach: async (_id, onFrame) => {
          receive = onFrame;
          return attachResult(
            chat.id,
            events.length,
            historyPage(chat.id, items(numbered(events.map((event) => [null, event])))),
            {
              chat,
              session: sessionInfo({ status, agent_name: "Codex" }),
              open_turn_id: turn,
            },
          );
        },
        interrupt: async () => {
          status = "cancelling";
          publish([ev.session({ status })]);
        },
        send: async () => {
          calls.send++;
          return { prompt_id: "queued", queued: true };
        },
      }),
    );
    transport.composer.steer = (_id, expected, input) => {
      calls.steer++;
      calls.expected = expected;
      message = `steer-${calls.steer}`;
      publish([
        { type: "steering_status", message_id: message, state: "pending", detail: null },
        ev.user(
          message,
          [
            input.text,
            ...input.mentions.map((path) => `@${path}`),
            ...input.attachments.map(() => "[File: interface-notes.md]"),
          ].join("\n"),
        ),
      ]);
      return new Promise((resolve) => {
        pending = resolve;
      });
    };
    const originalPreview = transport.conversation.preview;
    const originalTurns = transport.conversation.turns;
    transport.conversation.turns = async (id, before) => ({
      ...(await originalTurns(id, before)),
      can_continue_here: scenario === "remote-history",
    });
    transport.conversation.preview = async (id, action) => {
      recovery.previews.push(action.type);
      const preview = await originalPreview(id, action);
      return action.type === "fresh_session" || action.type === "continue_here"
        ? { ...preview, agent_id: chat.agent_id }
        : preview;
    };
    const originalPending = transport.conversation.pending;
    transport.conversation.pending = async (id) => {
      const pending = await originalPending(id);
      return pending && ["fresh_session", "continue_here"].includes(recovery.previews.at(-1) ?? "")
        ? { ...pending, agent_id: chat.agent_id }
        : pending;
    };
    const originalApply = transport.conversation.apply;
    transport.conversation.apply = (id, token) => {
      recovery.applied++;
      return originalApply(id, token);
    };
    Object.assign(window, { steeringCalls: calls, sessionRecoveryCalls: recovery });
    return {
      chat,
      transport,
      answer(state: "accepted" | "rejected" | "unconfirmed") {
        if (!pending) return;
        const detail = state === "accepted" ? null : `Fixture ${state}; your draft is kept.`;
        publish([{ type: "steering_status", message_id: message, state, detail }]);
        pending({ message_id: message, state, detail });
        pending = null;
      },
      end() {
        turn = null;
        status = "ready";
        publish([ev.turnEnded("fixture-turn"), ev.session({ status })]);
      },
    };
  });
  return (
    <main
      className="chat-app"
      data-theme="dark"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <h1 className="sr-only">Steering verification</h1>
      <nav
        aria-label="Fixture outcomes"
        style={{ position: "relative", display: "flex", flexShrink: 0, gap: 12, padding: 12 }}
      >
        <button type="button" className="g-button" onClick={() => fixture.answer("accepted")}>
          Accept
        </button>
        <button type="button" className="g-button" onClick={() => fixture.answer("rejected")}>
          Reject
        </button>
        <button type="button" className="g-button" onClick={() => fixture.answer("unconfirmed")}>
          Lose reply
        </button>
        <button type="button" className="g-button" onClick={() => fixture.end()}>
          End turn
        </button>
      </nav>
      <div className="chat-main" style={{ flex: 1, minHeight: 0 }}>
        <ChatView
          chatId={fixture.chat.id}
          transport={fixture.transport}
          listed={fixture.chat}
          storage={null}
          agents={[]}
        />
      </div>
    </main>
  );
}

export function mountSteeringPreview(container: HTMLElement) {
  createRoot(container).render(<Preview />);
}

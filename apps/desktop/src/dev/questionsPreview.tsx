/** Owned browser fixture for pending questions. It makes no native or agent calls. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuraEvent, EventBatch, UiAnswer, UiPrompt } from "../bindings";
import { ChatView } from "../components/chat/ChatView";
import {
  attachResult,
  chatSummary,
  ev,
  FakeTransport,
  frame,
  historyPage,
  items,
  numbered,
  sessionInfo,
} from "../lib/chat/testing";
import { withPreviewContext } from "./previewContext";

function Preview() {
  const [revision, setRevision] = useState(0);
  const [fixture] = useState(() => {
    const scenario = new URLSearchParams(location.search).get("case");
    const status = scenario === "startup" ? "starting" : "running";
    const chat = chatSummary("questions-chat", { status });
    const events: AuraEvent[] = [];
    for (let i = 0; i < 90; i++)
      events.push(
        ev.turnStarted(`old-${i}`),
        ev.user(`user-${i}`, `Older prompt ${i}`),
        ev.message(`message-${i}`, `Earlier saved answer ${i}`),
        ev.turnEnded(`old-${i}`),
      );
    if (status === "running")
      events.push(ev.turnStarted("current"), ev.user("current-user", "Inspect the checkout"));
    let receive: ((value: EventBatch) => void) | null = null;
    let pending: {
      id: string;
      answer: UiAnswer | null;
      resolve: () => void;
      reject: (error: Error) => void;
    } | null = null;
    const calls: { id: string; answer: UiAnswer | null }[] = [];
    let sent = false;
    const publish = (updates: AuraEvent[]) => {
      const start = events.length;
      events.push(...updates);
      receive?.(frame(chat.id, start, updates));
    };
    const transport = withPreviewContext(
      new FakeTransport({
        attach: async (_id, onFrame) => {
          receive = onFrame;
          return attachResult(
            chat.id,
            events.length,
            historyPage(chat.id, items(numbered(events.map((event) => [null, event])))),
            {
              chat,
              session: sessionInfo({ status }),
              open_turn_id: status === "running" ? "current" : null,
            },
          );
        },
        respondUi: async (_chat, id, answer) => {
          calls.push({ id, answer });
          return new Promise<void>((resolve, reject) => {
            pending = { id, answer, resolve, reject };
          });
        },
      }),
    );
    Object.assign(window, { questionCalls: calls });
    return {
      chat,
      transport,
      ask() {
        if (sent) return;
        sent = true;
        const prompt: UiPrompt =
          scenario === "startup"
            ? {
                type: "select",
                message:
                  "Codex could not open this session: original startup error. Try the advertised default?",
                options: ["Use advertised default", "Keep current model and stop"],
              }
            : {
                type: "questions",
                message: "Choose the review scope",
                questions: [
                  {
                    id: "scope",
                    header: "Scope",
                    question: "Which tests should run?",
                    options: [
                      { label: "Unit tests", description: "Run the focused suite" },
                      { label: "All tests", description: "Run all suites" },
                    ],
                    multi_select: false,
                    allow_free_text: true,
                  },
                ],
              };
        publish([
          { type: "ui_request", request_id: "question-1", prompt },
          {
            type: "ui_request",
            request_id: "notification",
            prompt: { type: "notify", message: "Informational update only" },
          },
        ]);
        if (scenario === "mixed") publish([ev.permission("permission-1")]);
      },
      resolve() {
        if (!pending) return;
        publish([ev.questionResolved(pending.id, pending.answer)]);
        pending.resolve();
        pending = null;
      },
      fail() {
        pending?.reject(new Error("Answer was not delivered. Try again."));
        pending = null;
      },
      withdraw() {
        publish([ev.questionResolved("question-1", null, "agent")]);
        pending?.resolve();
        pending = null;
      },
      update() {
        publish([ev.notice("New background update")]);
      },
    };
  });
  return (
    <main
      className="chat-app"
      data-theme="dark"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <h1 className="sr-only">Question dock verification</h1>
      <nav
        aria-label="Fixture controls"
        className="ui-row"
        style={{ position: "relative", flexShrink: 0, padding: 12 }}
      >
        <button type="button" className="g-button" onClick={fixture.ask}>
          Ask question
        </button>
        <button type="button" className="g-button" onClick={fixture.resolve}>
          Resolve answer
        </button>
        <button type="button" className="g-button" onClick={fixture.fail}>
          Fail answer
        </button>
        <button type="button" className="g-button" onClick={fixture.withdraw}>
          Withdraw question
        </button>
        <button type="button" className="g-button" onClick={fixture.update}>
          Background update
        </button>
        <button
          type="button"
          className="g-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          Reattach chat
        </button>
      </nav>
      <div className="chat-main" style={{ flex: 1, minHeight: 0 }}>
        <ChatView
          key={revision}
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
export function mountQuestionsPreview(container: HTMLElement) {
  createRoot(container).render(<Preview />);
}

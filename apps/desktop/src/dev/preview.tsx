/** Development-only visual harness. It never starts a process or uses the native transport. */
import { useOrbitTheme } from "@auracode/ui/orbit";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import fullAuto from "../../../../crates/aura-drivers/tests/fixtures/claude/recorded-full-auto.events.json";
import thinking from "../../../../crates/aura-drivers/tests/fixtures/claude/recorded-thinking.events.json";
import type { AgentEntry, AuraEvent, EventBatch, SessionStatus } from "../bindings";
import { AgentDock } from "../components/chat/AgentDock";
import { ChatList } from "../components/chat/ChatList";
import { ChatView } from "../components/chat/ChatView";
import { NewChat } from "../components/chat/NewChat";
import { NewChatDraft } from "../lib/chat/appStore";
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

const AGENT: AgentEntry = {
  id: "claude",
  name: "Claude Code",
  description: "Your installed Claude Code CLI",
  availability: { state: "ready", version: "2.1.310", path: "Recorded protocol fixture" },
  launch: "claude",
  needs_download: false,
  last_verified: "2026-10-26",
};

/** Driver golden events receive only the actor's turn boundaries needed by the real chat store. */
function recorded(source: { events: readonly { type: string; data: unknown }[] }): AuraEvent[] {
  const events: AuraEvent[] = [];
  const turns = new Set<string>();
  for (const envelope of source.events) {
    if (envelope.type === "event") {
      const data = envelope.data as { turn: string | null; event: AuraEvent };
      if (data.turn !== null && !turns.has(data.turn)) {
        turns.add(data.turn);
        events.push(ev.turnStarted(data.turn));
      }
      events.push(data.event);
    } else if (envelope.type === "turn_ended") {
      const data = envelope.data as Extract<AuraEvent, { type: "turn_ended" }>;
      events.push({ ...data, type: "turn_ended", duration_ms: null, recovered: false });
    }
  }
  return events;
}

function synthetic(mode: string): AuraEvent[] {
  if (mode === "focus-group")
    return [
      ev.turnStarted("focus-group"),
      ev.user("focus-user", "Keep the focused output available."),
      ev.toolCall("focus-first", {
        status: "in_progress",
        title: "Read the first file",
        content: [{ type: "text", text: "First output", truncated: null }],
      }),
    ];
  if (mode === "long-output")
    return [
      ev.turnStarted("long-output"),
      ev.user("long-output-user", "Run the checks."),
      ev.toolCall("long-output-tool", {
        kind: "execute",
        title: "Run cargo test",
        status: "failed",
        content: [
          {
            type: "terminal",
            output: Array.from(
              { length: 100 },
              (_, index) => `Check ${index + 1}: ${index === 99 ? "failed" : "passed"}`,
            ).join("\n"),
            exit_code: 1,
            truncated: null,
          },
        ],
      }),
      ev.turnEnded("long-output"),
    ];
  if (mode === "diff")
    return [
      ev.turnStarted("diff-turn"),
      ev.user("diff-user", "Update the configuration."),
      ev.toolCall("diff-tool", {
        kind: "edit",
        title: "Update src/settings.ts",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "src/settings.ts",
            old_text: Array.from(
              { length: 20 },
              (_, index) => `const setting${index} = false;`,
            ).join("\n"),
            new_text: Array.from(
              { length: 20 },
              (_, index) => `const setting${index} = true;`,
            ).join("\n"),
            truncated: null,
          },
        ],
      }),
      ev.turnEnded("diff-turn"),
    ];
  if (mode === "long-prompt")
    return [
      ev.turnStarted("long-prompt"),
      ev.user(
        "long-prompt-user",
        Array.from(
          { length: 30 },
          (_, index) => `Requirement ${index + 1}: preserve this entire prompt.`,
        ).join("\n"),
      ),
      ev.turnEnded("long-prompt"),
    ];
  if (mode === "partial-message")
    return [
      ev.turnStarted("long"),
      ev.user("long-user", "Review the saved message."),
      ...Array.from({ length: 80 }, (_, index) =>
        ev.message(
          "whole-message",
          `Paragraph ${index === 20 || index === 60 ? 40 : index}: ${"A saved message in the same turn. ".repeat(4)}\n\n`,
        ),
      ),
      ev.messageDone("whole-message"),
      ev.turnEnded("long"),
    ];
  if (mode === "large-turn")
    return [
      ev.turnStarted("large"),
      ev.user("large-user", "Review these files."),
      ev.thought("large-thought", "Inspecting the files."),
      ev.thoughtDone("large-thought", 1000),
      ...Array.from({ length: 1000 }, (_, index) =>
        ev.toolCall(`large-tool-${index}`, {
          title: `Read file ${index}`,
          status: "completed",
          content: [{ type: "text", text: `Saved output ${index}`, truncated: null }],
        }),
      ),
      ev.turnEnded("large"),
    ];
  if (mode === "partial-history")
    return [
      ev.turnStarted("long"),
      ev.user("long-user", "Review the saved messages."),
      ...Array.from({ length: 80 }, (_, index) => [
        ev.message(
          `part-${index}`,
          `Paragraph ${index}: ${"A saved message in the same turn. ".repeat(4)}`,
        ),
        ev.messageDone(`part-${index}`),
      ]).flat(),
      ev.turnEnded("long"),
    ];
  if (mode === "history-question")
    return [
      ...synthetic("history"),
      ev.turnStarted("question-turn"),
      {
        type: "ui_request",
        request_id: "draft-question",
        prompt: { type: "input", message: "Describe the change", placeholder: null },
      },
    ];
  if (mode === "history")
    return Array.from({ length: 500 }, (_, index) => [
      ev.turnStarted(`history-${index}`),
      ev.user(`user-${index}`, `Review file ${index + 1}.`),
      ev.message(
        `message-${index}`,
        `Review ${index + 1}: the saved conversation remains available.\n\n${"This paragraph gives this turn a different measured height. ".repeat(1 + (index % 7))}\n\n[Review documentation](https://example.test/review/${index})`,
      ),
      ev.messageDone(`message-${index}`),
      ev.turnEnded(`history-${index}`),
    ]).flat();
  const events = [
    ev.turnStarted("first"),
    ev.user("u1", "Make the project list easier to scan, and keep the active chat visible."),
    ev.thought("thought", "I will check the sidebar layout and its existing keyboard behavior."),
    ev.thoughtDone("thought", 2400),
    ev.toolCall("read", {
      title: "Read Sidebar.tsx",
      status: "completed",
      locations: [{ path: "src/components/Sidebar.tsx", line: 18 }],
      content: [
        {
          type: "text",
          text: 'export function Sidebar() {\n  return <nav aria-label="Projects">...</nav>;\n}',
          truncated: null,
        },
      ],
    }),
    ev.toolCall("test", {
      kind: "execute",
      title: "pnpm test -- sidebar",
      status: "completed",
      content: [
        {
          type: "terminal",
          output: "✓ keeps the selected chat visible\n✓ preserves keyboard focus\n\n2 tests passed",
          exit_code: 0,
          truncated: null,
        },
      ],
    }),
    ev.message(
      "answer",
      'The sidebar now keeps the active chat visible and gives each project a clearer heading.\n\n- **Keyboard focus** stays on the same chat when new activity arrives.\n- **Needs you** collects pending requests without duplicating chats.\n\n```tsx\n<nav aria-label="Projects">\n  <ProjectList selected={chat.id} />\n</nav>\n```\n\nBoth sidebar tests pass.',
    ),
    ev.messageDone("answer"),
    ev.turnEnded("first", "end_turn", { durationMs: 18400 }),
  ];
  if (mode === "settled") return events;
  events.push(ev.turnStarted("next"), ev.user("u2", "Check the small window layout too."));
  if (mode === "permission")
    events.push(
      ev.toolCall("cmd", { kind: "execute", title: "pnpm test -- sidebar" }),
      ev.permission("permission"),
    );
  else if (mode === "error")
    events.push(
      ev.error(
        "agent_exited",
        "The agent stopped unexpectedly.",
        "The visible transcript is still saved.",
      ),
      ev.turnEnded("next", "error"),
    );
  else events.push(ev.thought("next-thought", "Checking the narrow layout and the focus order."));
  return events;
}

function Preview() {
  const requested = new URLSearchParams(location.search).get("preview") ?? "settled";
  const mode = [
    "settled",
    "thinking",
    "permission",
    "error",
    "new",
    "history",
    "history-question",
    "partial-history",
    "partial-message",
    "large-turn",
    "long-prompt",
    "long-output",
    "focus-group",
    "diff",
    "recorded-thinking",
    "recorded-tools",
  ].includes(requested)
    ? requested
    : "settled";
  const systemTheme = useOrbitTheme();
  const [selected, setSelected] = useState<string | null>(mode === "new" ? null : "preview");
  const status: SessionStatus =
    mode === "thinking" ||
    mode === "permission" ||
    mode === "history-question" ||
    mode === "focus-group"
      ? "running"
      : mode === "error"
        ? "failed"
        : "ready";
  const chat = useMemo(
    () =>
      chatSummary("preview", {
        title: "Make the sidebar easier to scan",
        agent_id: "claude",
        agent_name: AGENT.name,
        folder: "/workspace/auracode",
        status,
        needs_attention: mode === "permission",
      }),
    [mode, status],
  );
  const publishPreview = useRef<((updates: AuraEvent[]) => void) | null>(null);
  useEffect(() => {
    if (mode !== "focus-group") return;
    const step = (event: Event) => {
      if ((event as CustomEvent).detail === "add")
        publishPreview.current?.([
          ev.toolCall("focus-second", {
            status: "in_progress",
            title: "Read the second file",
            content: [{ type: "text", text: "Second output", truncated: null }],
          }),
        ]);
      else if ((event as CustomEvent).detail === "finish")
        publishPreview.current?.([
          ev.toolUpdate("focus-first", { status: "completed" }),
          ev.toolUpdate("focus-second", { status: "completed" }),
          ev.turnEnded("focus-group"),
        ]);
    };
    window.addEventListener("auracode-preview-tool-step", step);
    return () => window.removeEventListener("auracode-preview-tool-step", step);
  }, [mode]);
  const transport = useMemo(() => {
    const events =
      mode === "recorded-thinking"
        ? recorded(thinking)
        : mode === "recorded-tools"
          ? recorded(fullAuto)
          : synthetic(mode);
    let seq = events.length;
    const history = items(numbered(events.map((event) => [null, event] as const)));
    const before =
      mode === "partial-message"
        ? 42
        : mode === "partial-history"
          ? 82
          : mode.startsWith("history")
            ? 1250
            : null;
    const initialHistory = before === null ? history : history.slice(before);
    let receive: ((batch: EventBatch) => void) | null = null;
    const publish = (updates: AuraEvent[]) => {
      receive?.(frame("preview", seq, updates));
      seq += updates.length;
    };
    publishPreview.current = publish;
    return new FakeTransport({
      attach: async (chatId, onFrame) => {
        receive = onFrame;
        return attachResult(
          chatId,
          seq,
          historyPage(chatId, initialHistory, {
            has_more: before !== null,
            before_seq: before,
            cut_turn_id: mode.startsWith("partial-") ? "long" : null,
          }),
          { chat, session: sessionInfo({ agent_name: AGENT.name, status }) },
        );
      },
      history: async (chatId) => historyPage(chatId, history.slice(0, before ?? 0)),
      pickFolder: async () => "/workspace/auracode",
      respondPermission: async (_chatId, requestId, optionId) =>
        publish([ev.permissionResolved(requestId, optionId)]),
      send: async (_chatId, text) => {
        publish([
          ev.turnStarted("preview-send"),
          ev.user("preview-user", text),
          ev.message(
            "preview-answer",
            "This is a local UI preview. No prompt was sent to an agent.",
          ),
          ev.messageDone("preview-answer"),
          ev.turnEnded("preview-send"),
        ]);
        return { prompt_id: "preview-send", queued: false };
      },
    });
  }, [mode, status, chat]);
  const draft = useMemo(() => new NewChatDraft(transport), [transport]);
  return (
    <div className="chat-app orbit-theme" data-theme={systemTheme} data-glass="none">
      <aside className="chat-sidebar" aria-label="Sidebar">
        <ChatList
          chats={[
            chat,
            chatSummary("older", {
              title: "Set up the project",
              folder: chat.folder,
              agent_name: "Codex",
              agent_id: "codex",
            }),
          ]}
          error={null}
          selected={selected}
          onSelect={() => setSelected("preview")}
          onNewChat={() => setSelected(null)}
        />
        <AgentDock
          agents={[AGENT]}
          chats={[chat]}
          onChoose={() => setSelected(null)}
          onDiagnostics={() =>
            alert("This is a development-only protocol fixture. No agents run here.")
          }
        />
      </aside>
      <main className="chat-main">
        {selected === null ? (
          <NewChat
            agents={[AGENT]}
            refreshing={false}
            draft={draft}
            onRefreshAgents={() => {}}
            onCreated={() => setSelected("preview")}
          />
        ) : (
          <ChatView
            chatId="preview"
            transport={transport}
            listed={chat}
            storage={null}
            agents={[AGENT]}
          />
        )}
      </main>
    </div>
  );
}

export function mountPreview(container: HTMLElement): void {
  createRoot(container).render(<Preview />);
}

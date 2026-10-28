/** Development-only visual harness. It never starts a process or uses the native transport. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import fullAuto from "../../../../crates/aura-drivers/tests/fixtures/claude/recorded-full-auto.events.json";
import thinking from "../../../../crates/aura-drivers/tests/fixtures/claude/recorded-thinking.events.json";
import type { AgentEntry, AuraEvent, EventBatch, SessionStatus } from "../bindings";
import { ChatList } from "../components/chat/ChatList";
import { SidebarBand } from "../components/chat/ChatsScreen";
import { ChatView } from "../components/chat/ChatView";
import { CommandPalette, type PaletteCommand } from "../components/chat/CommandPalette";
import { SidebarFooter } from "../components/chat/SidebarFooter";
import { createXtermRuntime } from "../components/chat/terminalRuntime";
import { PANE_SWIMMERS, Water } from "../components/Water";
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
import { TerminalPanels } from "../lib/terminalPanel";
import { MISSING_FOLDER, missingWorktreeGit } from "./missingWorktreeFixture";
import { NewChatPreview } from "./newChatPreview";
import type { NewChatScenario } from "./newChatWorktreeFixture";
import { withPreviewContext } from "./previewContext";
import { terminalPanelFixture } from "./terminalPanelFixture";

/**
 * New chat in a project folder, with Rust's worktree review imitated: a Git folder (the default
 * worktree), one with a saved setup, one with no commit yet, and a plain folder.
 */
const NEW_CHAT_SCENARIOS: Readonly<Record<string, NewChatScenario>> = {
  "new-worktree": "worktree",
  "new-setup": "setup",
  "new-unavailable": "unavailable",
  "new-plain": "plain",
};

const AGENT: AgentEntry = {
  id: "claude",
  name: "Claude Code",
  description: "Your installed Claude Code CLI",
  availability: { state: "ready", version: "2.1.310", path: "Recorded protocol fixture" },
  launch: "claude",
  needs_download: false,
  last_verified: "2026-10-26",
  installation: null,
  latest_release: null,
};

/**
 * `agents=lineup` offers a full lineup in the chat's picker (each agent's mark at 16px): four that
 * can run, one still being checked and three not installed. Without it the chat knows only its own.
 */
const LINEUP: readonly AgentEntry[] = [
  AGENT,
  ...(
    [
      ["codex", "Codex", "0.170.0"],
      ["cursor", "Cursor", "2026.10.22"],
      ["opencode", "OpenCode", "1.19.4"],
      ["pi", "Pi", "0.70.0"],
      ["grok", "Grok Build", null],
      ["omp", "oh-my-pi", null],
      ["hermes", "Hermes", null],
    ] as const
  ).map(
    ([id, name, version]): AgentEntry => ({
      ...AGENT,
      id,
      name,
      description: `Your installed ${name} CLI`,
      availability: version
        ? { state: "ready", version, path: `/usr/local/bin/${id}` }
        : { state: "missing", reason: `${name} is not installed.` },
      launch: id,
    }),
  ),
];
const CHAT_AGENTS: readonly AgentEntry[] =
  new URLSearchParams(location.search).get("agents") === "lineup" ? LINEUP : [AGENT];

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
  // A later start failed: the chat's worktree folder was deleted outside the app.
  if (mode === "missing-worktree")
    return [
      ...events,
      ev.error(
        "folder_missing",
        `The chat's folder ${MISSING_FOLDER} can't be found. Restore it (or reconnect its drive), then press Retry.`,
      ),
    ];
  events.push(ev.turnStarted("next"), ev.user("u2", "Check the small window layout too."));
  if (mode === "streaming") return events;
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

const STREAMED_ANSWER = `The composer now holds its shape at 960 pixels, and the sidebar keeps long titles on one line.

## What changed

- **Composer** keeps the agent, model and effort on one quiet row, and drops the model under 560 pixels.
- **Sidebar** truncates titles with an ellipsis and keeps the running state at the trailing edge.
- **Focus order** goes from the transcript to the composer, then to its controls.

\`\`\`css
.chat-composer {
  border: 1px solid var(--g-line-strong);
  border-radius: 16px;
  background: var(--g-surface-2);
}
\`\`\`

| Width | Composer | Sidebar |
| --- | --- | --- |
| 1440 | Full row | 264 px |
| 960 | Model hidden | 264 px |

All 24 layout tests pass. The narrow window keeps every control reachable from the keyboard, and the transcript column stays at 720 pixels wide until the window is narrower than the column.

The right panel still overlaps the composer below 880 pixels of chat width. It should float over the chat with a shadow there instead of squeezing the transcript, which keeps the reading column stable while files are reviewed.

Next, the permission card takes the composer's place while a request waits, so the answer is always where your hands already are.`;

/** A live turn played out over about ten seconds: a thought, four tools, then a long answer. */
function streamingScript(): { delay: number; events: AuraEvent[] }[] {
  const steps: { delay: number; events: AuraEvent[] }[] = [];
  const words = (text: string, size: number) => {
    const parts = text.split(/(?<= )/);
    const chunks: string[] = [];
    for (let index = 0; index < parts.length; index += size)
      chunks.push(parts.slice(index, index + size).join(""));
    return chunks;
  };
  for (const chunk of words(
    "Checking how the composer behaves at 960 pixels, then the sidebar truncation and the focus order. ",
    2,
  ))
    steps.push({ delay: 70, events: [ev.thought("stream-thought", chunk)] });
  steps.push({ delay: 120, events: [ev.thoughtDone("stream-thought", 1900)] });
  const file = "src/components/chat/Composer.tsx";
  steps.push({
    delay: 200,
    events: [
      ev.toolCall("stream-read", {
        kind: "read",
        title: `Read ${file}`,
        locations: [{ path: file, line: 124 }],
      }),
    ],
  });
  steps.push({
    delay: 500,
    events: [
      ev.toolUpdate("stream-read", {
        status: "completed",
        content: [
          {
            type: "text",
            text: 'return (\n  <div className="chat-composer">\n    <ContextChips context={context} />\n  </div>\n);',
            truncated: null,
          },
        ],
      }),
    ],
  });
  steps.push({
    delay: 150,
    events: [ev.toolCall("stream-search", { kind: "search", title: 'Search "chat-composer"' })],
  });
  steps.push({
    delay: 400,
    events: [
      ev.toolUpdate("stream-search", {
        status: "completed",
        content: [{ type: "text", text: "src/chat.css:1175\nsrc/shell.css:640", truncated: null }],
      }),
    ],
  });
  steps.push({
    delay: 150,
    events: [ev.toolCall("stream-test", { kind: "execute", title: "pnpm test -- layout" })],
  });
  const lines: string[] = [];
  for (let index = 1; index <= 10; index++) {
    lines.push(`✓ layout ${index} keeps its column at 960 pixels`);
    steps.push({
      delay: 120,
      events: [
        ev.toolUpdate("stream-test", {
          content: [
            { type: "terminal", output: lines.join("\n"), exit_code: null, truncated: null },
          ],
        }),
      ],
    });
  }
  steps.push({
    delay: 200,
    events: [
      ev.toolUpdate("stream-test", {
        status: "completed",
        content: [
          {
            type: "terminal",
            output: `${lines.join("\n")}\n\n24 tests passed`,
            exit_code: 0,
            truncated: null,
          },
        ],
      }),
    ],
  });
  steps.push({
    delay: 150,
    events: [
      ev.toolCall("stream-edit", {
        kind: "edit",
        title: "Edit src/chat.css",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "src/chat.css",
            old_text: ".chat-composer {\n  border-radius: 18px;\n  box-shadow: var(--o-e1);\n}",
            new_text: ".chat-composer {\n  border-radius: 16px;\n}",
            truncated: null,
          },
        ],
      }),
    ],
  });
  for (const chunk of words(STREAMED_ANSWER, 3))
    steps.push({ delay: 30, events: [ev.message("stream-answer", chunk)] });
  steps.push({ delay: 100, events: [ev.messageDone("stream-answer")] });
  steps.push({
    delay: 50,
    events: [ev.turnEnded("next", "end_turn", { durationMs: 21400 })],
  });
  return steps;
}

function Preview() {
  const requested = new URLSearchParams(location.search).get("preview") ?? "settled";
  const mode = [
    "settled",
    "streaming",
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
    "terminal-panel",
    "missing-worktree",
    ...Object.keys(NEW_CHAT_SCENARIOS),
  ].includes(requested)
    ? requested
    : "settled";
  // `?preview=terminal-panel&tabs=2&height=280`: the settled chat with its docked terminals open.
  const [terminals] = useState(() => {
    const params = new URLSearchParams(location.search);
    return new TerminalPanels(
      terminalPanelFixture({ refuse: params.get("refuse"), failReview: params.get("fail-review") }),
      createXtermRuntime,
    );
  });
  useEffect(() => {
    if (mode !== "terminal-panel") return;
    const params = new URLSearchParams(location.search);
    const count = Math.max(1, Math.min(8, Number(params.get("tabs") ?? "2") || 1));
    void (async () => {
      for (let index = 0; index < count; index++)
        await terminals.newTab("preview", index % 2 === 1 ? "command_prompt" : "power_shell");
      const first = terminals.panel("preview").tabs[0];
      if (first) terminals.select("preview", first);
      const height = Number(params.get("height"));
      if (height) terminals.setHeight("preview", height);
    })();
    return () => void terminals.dispose();
  }, [mode, terminals]);
  const scenario = NEW_CHAT_SCENARIOS[mode] ?? null;
  const [palette, setPalette] = useState(false);
  const [chatCommands, setChatCommands] = useState<readonly PaletteCommand[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    mode === "new" || scenario ? null : "preview",
  );
  const status: SessionStatus =
    mode === "thinking" ||
    mode === "streaming" ||
    mode === "permission" ||
    mode === "history-question" ||
    mode === "focus-group"
      ? "running"
      : mode === "error" || mode === "missing-worktree"
        ? "failed"
        : "ready";
  const chat = useMemo(
    () =>
      chatSummary("preview", {
        title: "Make the sidebar easier to scan",
        agent_id: "claude",
        agent_name: AGENT.name,
        folder: mode === "missing-worktree" ? MISSING_FOLDER : "/workspace/auracode",
        folder_state: mode === "missing-worktree" ? "missing" : "ok",
        status,
        needs_attention: mode === "permission",
      }),
    [mode, status],
  );
  const publishPreview = useRef<((updates: AuraEvent[]) => void) | null>(null);
  const attached = useRef(false);
  useEffect(() => {
    if (mode !== "streaming") return;
    // Plays one live turn once the chat has joined, as an agent would stream it.
    const steps = streamingScript();
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const step = steps[index];
      if (!step) return;
      timer = setTimeout(() => {
        publishPreview.current?.(step.events);
        index++;
        next();
      }, step.delay);
    };
    const wait = setInterval(() => {
      if (!attached.current) return;
      clearInterval(wait);
      timer = setTimeout(next, 600);
    }, 50);
    return () => {
      clearInterval(wait);
      clearTimeout(timer);
    };
  }, [mode]);
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
          : synthetic(mode === "terminal-panel" ? "settled" : mode);
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
    let currentStatus: SessionStatus = status;
    let choices = lists(1, {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          description: null,
          pending: null,
          kind: {
            type: "select",
            current: "sonnet",
            choices: [
              {
                value: "sonnet",
                name: "Sonnet",
                description: "Balanced coding and reasoning",
                group: null,
              },
              {
                value: "haiku",
                name: "Haiku",
                description: "Fast answers and smaller tasks",
                group: null,
              },
            ],
          },
        },
        {
          id: "effort",
          name: "Effort",
          category: "effort",
          description: null,
          pending: null,
          kind: {
            type: "select",
            current: "medium",
            choices: [
              { value: "low", name: "Low", description: null, group: null },
              { value: "medium", name: "Medium", description: null, group: null },
              { value: "high", name: "High", description: null, group: null },
            ],
          },
        },
      ],
    });
    const publish = (updates: AuraEvent[]) => {
      receive?.(frame("preview", seq, updates));
      seq += updates.length;
    };
    publishPreview.current = publish;
    const context = withPreviewContext(
      new FakeTransport({
        lists: async () => choices,
        setOption: async (_chatId, id, value) => {
          choices = {
            ...choices,
            revision: choices.revision + 1,
            options: choices.options.map((option) =>
              option.id === id && option.kind.type === "select" && value.type === "choice"
                ? { ...option, kind: { ...option.kind, current: value.value } }
                : option,
            ),
          };
          return choices;
        },
        attach: async (chatId, onFrame) => {
          receive = onFrame;
          attached.current = true;
          return attachResult(
            chatId,
            seq,
            historyPage(chatId, initialHistory, {
              has_more: before !== null,
              before_seq: before,
              cut_turn_id: mode.startsWith("partial-") ? "long" : null,
            }),
            {
              chat: { ...chat, status: currentStatus },
              session: sessionInfo({ agent_name: AGENT.name, status: currentStatus }),
            },
          );
        },
        history: async (chatId) => historyPage(chatId, history.slice(0, before ?? 0)),
        pickFolder: async () => "/workspace/auracode",
        stop: async () => {
          currentStatus = "stopped";
          publish([ev.session(sessionInfo({ agent_name: AGENT.name, status: currentStatus }))]);
        },
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
      }),
    );
    return mode === "missing-worktree"
      ? Object.assign(context, { git: missingWorktreeGit() })
      : context;
  }, [mode, status, chat]);
  return (
    // Mirrors ChatsScreen's frame: the drag bands, the sidebar toggle, the panes.
    <div
      className="chat-app"
      data-theme="dark"
      data-glass="none"
      data-os={new URLSearchParams(location.search).get("os") ?? "windows"}
      data-sidebar-collapsed={collapsed}
    >
      <aside className="chat-sidebar" aria-label="Sidebar">
        <SidebarBand collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <ChatList
          onSearch={() => setPalette(true)}
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
        <SidebarFooter
          profile={{ id: "local", kind: "local", display_name: "Local", created_at: 1 }}
          onSettings={() =>
            alert("This is a development-only protocol fixture. No agents run here.")
          }
        />
      </aside>
      <main className="chat-main">
        {selected === null ? <Water className="pane-water" swimmers={PANE_SWIMMERS} /> : null}
        <div className="chat-drag" />
        {selected === null ? (
          <NewChatPreview
            base={AGENT}
            scenario={scenario}
            onCreated={() => setSelected("preview")}
          />
        ) : (
          <ChatView
            onCommands={setChatCommands}
            terminals={terminals}
            chatId="preview"
            transport={transport}
            listed={chat}
            storage={null}
            agents={CHAT_AGENTS}
          />
        )}
      </main>
      {palette ? (
        <CommandPalette
          transport={transport}
          chatId={selected}
          onClose={() => setPalette(false)}
          onChat={() => setSelected("preview")}
          commands={[
            ...(selected !== null ? chatCommands : []),
            {
              id: "new",
              title: "New chat",
              detail: "Choose an agent and project",
              run: () => setSelected(null),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export function mountPreview(container: HTMLElement): void {
  createRoot(container).render(<Preview />);
}

/**
 * Scripted Processes fixture (`?preview=processes`, `&case=empty`). Never reads the process table
 * or stops anything: the snapshot is invented, and Stop removes the row and what it started.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { BackgroundTask, ChatSummary, ProcessesSnapshot, ProcessRow } from "../bindings";
import { ProcessesScreen } from "../components/processes/ProcessesScreen";
import type { AppStore } from "../lib/chat/appStore";
import type { ProcessesApi } from "../lib/processes";

const started = Date.now() - 12 * 60_000;

const summary = (id: string, title: string, agent: string, status: ChatSummary["status"]) =>
  ({
    id,
    title,
    agent_id: agent.toLowerCase(),
    agent_name: agent,
    folder: "C:\\work\\auracode",
    folder_state: "ok",
    status,
    needs_attention: false,
    created_at: started,
    updated_at: started,
  }) as ChatSummary;

const task = (id: string, extra: Partial<BackgroundTask>): BackgroundTask => ({
  task_id: id,
  kind: "agent",
  title: "Task",
  agent_type: "Explore",
  tool_call_id: null,
  parent_task_id: null,
  backgrounded: true,
  status: "running",
  activity: null,
  tool_uses: null,
  tokens: null,
  duration_ms: null,
  started_at: Date.now() - 74_000,
  ended_at: null,
  prompt: null,
  summary: null,
  summary_truncated: null,
  ...extra,
});

function fixture(empty: boolean) {
  const row = (
    pid: number,
    parent: number | null,
    name: string,
    command: string,
    minutes: number,
    megabytes: number,
  ): ProcessRow => ({
    pid,
    parent,
    name,
    command,
    started_ms: Date.now() - minutes * 60_000,
    cpu_ms: 0,
    memory_bytes: megabytes * 1024 * 1024,
  });
  let rows: ProcessRow[] = [
    row(
      4120,
      null,
      "claude.exe",
      "claude -p --input-format stream-json --output-format stream-json --verbose",
      12,
      214,
    ),
    row(4388, 4120, "bash.exe", "bash -c cargo test -p auracode-desktop", 2, 9),
    row(5102, 4388, "cargo.exe", "cargo test -p auracode-desktop --lib dictation", 2, 61),
    row(5630, null, "auracode.exe", "C:\\Users\\me\\AppData\\Local\\auracode\\auracode.exe", 1, 96),
  ];
  const codex: ProcessRow[] = [
    row(6610, null, "codex.exe", "codex app-server", 40, 88),
    row(6702, 6610, "node.exe", "node scripts/check-dictation.mjs", 0, 134),
  ];
  const opened = Date.now();
  const api: ProcessesApi = {
    snapshot: async () => {
      // Each program has used a steady share of one core since the page opened: 4% to 36%.
      const busy = (list: ProcessRow[]) =>
        list.map((entry, index) => ({
          ...entry,
          cpu_ms: Math.round((Date.now() - opened) * (0.04 + index * 0.08)),
        }));
      const snapshot: ProcessesSnapshot = {
        taken_at_ms: Date.now(),
        chats: empty
          ? []
          : [
              {
                chat_id: "chat-claude",
                agents: [{ pid: 4120, processes: busy(rows) }],
                tasks: [
                  task("explore-dictation", {
                    title: "Explore dictation feature end to end",
                    activity: "Reading audio.rs",
                    tool_uses: 12,
                  }),
                  task("explore-themes", {
                    title: "Explore theming system and changelog",
                    activity: "Searching for data-theme",
                    tool_uses: 7,
                  }),
                  task("tests", {
                    kind: "command",
                    agent_type: null,
                    title: "Run the desktop tests",
                    status: "completed",
                    started_at: Date.now() - 600_000,
                    duration_ms: 41_000,
                  }),
                ],
              },
              {
                chat_id: "chat-codex",
                agents: [{ pid: 6610, processes: busy(codex) }],
                tasks: [],
              },
            ],
      };
      return snapshot;
    },
    stop: async (_chatId, pid) => {
      const gone = new Set([pid]);
      for (const entry of rows)
        if (entry.parent !== null && gone.has(entry.parent)) gone.add(entry.pid);
      rows = rows.filter((entry) => !gone.has(entry.pid));
    },
  };
  const chats = [
    summary("chat-claude", "Fix dictation on Windows", "Claude Code", "running"),
    summary("chat-codex", "Check the dictation fixture", "Codex", "ready"),
  ];
  // useSyncExternalStore needs the same object back until something changes.
  const state = { chats };
  const app = {
    subscribe: () => () => {},
    getSnapshot: () => state,
  } as unknown as AppStore;
  return { api, app };
}

export function mountProcessesPreview(container: HTMLElement) {
  const empty = new URLSearchParams(location.search).get("case") === "empty";
  const { api, app } = fixture(empty);
  createRoot(container).render(
    <StrictMode>
      <ProcessesScreen app={app} api={api} onBack={() => {}} onOpenChat={() => {}} />
    </StrictMode>,
  );
}

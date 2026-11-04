import { ArrowLeft, Square } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
  BackgroundTask,
  ChatProcesses,
  ChatSummary,
  ProcessesSnapshot,
  SessionStatus,
} from "../../bindings";
import type { AppStore } from "../../lib/chat/appStore";
import type { TaskItem } from "../../lib/chat/tasks";
import { errorMessage } from "../../lib/errors";
import {
  cpuPercent,
  formatBytes,
  formatUptime,
  listTree,
  orderedTasks,
  type ProcessesApi,
  processCount,
  processesApi,
  REFRESH_MS,
} from "../../lib/processes";
import { TaskLine, taskFacts, useClock } from "../chat/BackgroundTasks";
import "./processes.css";

const STATUS_WORDS: Record<SessionStatus, string> = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Idle",
  running: "Working",
  cancelling: "Stopping its turn",
  stopping: "Stopping",
  failed: "Failed to start",
  auth_required: "Needs sign-in",
};

/** The snapshot shown and the one before it, for processor use between the two. */
interface Reading {
  readonly previous: ProcessesSnapshot | null;
  readonly current: ProcessesSnapshot | null;
}

/**
 * Processes: everything each chat's agent runs, read from the process table every two seconds
 * while the page is open, and its subagents and background commands. A process under an agent can
 * be stopped here; the agent itself stops from its chat.
 */
export function ProcessesScreen({
  app,
  api = processesApi,
  onBack,
  onOpenChat,
}: {
  readonly app: AppStore;
  readonly api?: ProcessesApi;
  readonly onBack: () => void;
  readonly onOpenChat: (chatId: string) => void;
}) {
  const summaries = useSyncExternalStore(app.subscribe, app.getSnapshot).chats ?? [];
  const [reading, setReading] = useState<Reading>({ previous: null, current: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState<ReadonlySet<number>>(new Set());
  const now = useClock(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.snapshot();
      setReading((last) => ({ previous: last.current, current: next }));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) await refresh();
      if (alive) timer = setTimeout(tick, REFRESH_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  const stop = async (chatId: string, pid: number, name: string) => {
    setStopping((current) => new Set(current).add(pid));
    setNotice(null);
    try {
      await api.stop(chatId, pid);
      setNotice(`Stopped ${name} (process ${pid}) and what it started.`);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(pid);
        return next;
      });
    }
  };

  const snapshot = reading.current;
  const chats = snapshot?.chats ?? [];
  const count = processCount(snapshot);
  const summary =
    snapshot === null
      ? "Reading what your agents run."
      : chats.length === 0
        ? "No agent is running right now."
        : `${count} ${count === 1 ? "process" : "processes"} under ${chats.length} ${
            chats.length === 1 ? "chat" : "chats"
          }. Updated every 2 seconds.`;

  return (
    <main className="setup-shell g-root processes-screen" data-testid="processes-screen">
      <div className="setup-drag" data-tauri-drag-region="" />
      <div className="processes-page">
        <header className="processes-bar">
          <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to chats
          </button>
        </header>
        <div className="processes-head">
          <h1>Processes</h1>
          <p>{summary}</p>
        </div>
        {error !== null ? (
          <p role="alert" className="ui-error processes-message">
            {error}
          </p>
        ) : null}
        <p role="status" className="processes-message">
          {notice}
        </p>
        {snapshot === null && error === null ? (
          <div className="processes-empty">
            <span className="ui-pulse" aria-hidden="true" />
            <p>Reading the process table…</p>
          </div>
        ) : null}
        {snapshot !== null && chats.length === 0 ? (
          <div className="processes-empty">
            <p>
              Programs show here while a chat's agent runs: the agent, its subagents and background
              commands, and everything they start.
            </p>
          </div>
        ) : null}
        {chats.map((chat) => (
          <ChatProcessesSection
            key={chat.chat_id}
            chat={chat}
            summary={summaries.find((candidate) => candidate.id === chat.chat_id)}
            reading={reading}
            now={now}
            stopping={stopping}
            onStop={stop}
            onOpenChat={onOpenChat}
          />
        ))}
      </div>
    </main>
  );
}

function taskItem(task: BackgroundTask, order: number): TaskItem {
  return { task, steps: [], endedIn: null, order, placeholder: false };
}

function ChatProcessesSection({
  chat,
  summary,
  reading,
  now,
  stopping,
  onStop,
  onOpenChat,
}: {
  readonly chat: ChatProcesses;
  readonly summary: ChatSummary | undefined;
  readonly reading: Reading;
  readonly now: number;
  readonly stopping: ReadonlySet<number>;
  readonly onStop: (chatId: string, pid: number, name: string) => void;
  readonly onOpenChat: (chatId: string) => void;
}) {
  const heading = `process-chat-${chat.chat_id}`;
  const tasks = orderedTasks(chat.tasks);
  const rows = chat.agents.flatMap((agent) => listTree(agent.processes));
  const current = reading.current;
  return (
    <section className="process-chat" aria-labelledby={heading} data-testid="process-chat">
      <div className="process-chat-head">
        <div>
          <h2 id={heading}>{summary?.title ?? "Untitled chat"}</h2>
          <p>
            {[summary?.agent_name, summary ? STATUS_WORDS[summary.status] : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          type="button"
          className="g-button g-button-ghost g-button-28"
          onClick={() => onOpenChat(chat.chat_id)}
        >
          Open chat
        </button>
      </div>
      {tasks.length > 0 ? (
        <ul className="process-list" aria-label="Subagents and background commands">
          {tasks.map((task, index) => {
            const item = taskItem(task, index);
            return (
              <li key={task.task_id} className="process-task" data-testid="process-task">
                <TaskLine
                  item={item}
                  display={task.status}
                  activity={task.status === "running" ? task.activity : null}
                  facts={taskFacts(item, task.status, now)}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <ul className="process-list" aria-label="Programs">
        {rows.map(({ row, depth, root }) => {
          const cpu = current ? cpuPercent(reading.previous, current, row.pid) : null;
          const facts = [
            root ? "Agent" : null,
            `PID ${row.pid}`,
            cpu === null ? null : `${cpu < 10 ? cpu.toFixed(1) : Math.round(cpu)}% CPU`,
            formatBytes(row.memory_bytes),
            formatUptime(row.started_ms, now),
          ].filter((part): part is string => part !== null);
          return (
            <li
              key={row.pid}
              className="process-row"
              data-depth={Math.min(depth, 5)}
              data-testid="process-row"
            >
              <div className="process-row-text">
                <span className="process-name">{row.name}</span>
                <span className="process-facts">{facts.join(" · ")}</span>
                {row.command ? (
                  <code className="process-command" title={row.command}>
                    {row.command}
                  </code>
                ) : null}
              </div>
              {root ? null : (
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  aria-label={`Stop ${row.name}, process ${row.pid}`}
                  disabled={stopping.has(row.pid)}
                  onClick={() => onStop(chat.chat_id, row.pid, row.name)}
                >
                  <Square size={12} aria-hidden="true" /> Stop
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

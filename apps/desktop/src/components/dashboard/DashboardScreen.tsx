import { springs, usePrefersReducedMotion } from "@auracode/ui";
import { AgentMark, PixelLoader, StatusDot } from "@auracode/ui/graphite";
import { ArrowLeft, Check, ChevronRight, Square } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChatProcesses, ChatSummary, ProcessesSnapshot } from "../../bindings";
import type { AppStore } from "../../lib/chat/appStore";
import {
  boardOf,
  boardSummary,
  LANE_TITLES,
  LANES,
  type Lane,
  stateLine,
} from "../../lib/dashboard";
import { errorMessage } from "../../lib/errors";
import { ago } from "../../lib/plugins/format";
import {
  cpuPercent,
  formatBytes,
  formatUptime,
  listTree,
  orderedTasks,
  type ProcessesApi,
  processesApi,
  REFRESH_MS,
} from "../../lib/processes";
import { TaskKindIcon, TaskMark, taskFacts, useClock } from "../chat/BackgroundTasks";
import { projectName } from "../chat/ChatList";
import "./dashboard.css";

/** The snapshot shown and the one before it, for processor use between the two. */
interface Reading {
  readonly previous: ProcessesSnapshot | null;
  readonly current: ProcessesSnapshot | null;
}

const EMPTY: Record<Lane, string> = {
  attention: "Nothing needs you.",
  working: "No agent is working.",
  finished: "Nothing finished in the last day.",
};

/** A working card lists this many of its running tasks; the programs disclosure has the rest. */
const TASKS_SHOWN = 3;

/**
 * The Dashboard: every chat on a board of three lanes, Needs you, Working and Finished, each a card
 * that opens its chat. A working card says what its agent and its tasks are doing, and folds the
 * programs it runs (read from the process table every two seconds while the page is open), each
 * with Stop. Cards glide between lanes as their chats change.
 */
export function DashboardScreen({
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
  const reduced = usePrefersReducedMotion();

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

  const board = boardOf(summaries, now);
  // Each chat's lane at the last render: a card whose lane changed crosses over the others.
  const lanes = useRef(new Map<string, Lane>());
  const crossing = new Set<string>();
  for (const lane of LANES)
    for (const chat of board[lane]) {
      const before = lanes.current.get(chat.id);
      if (before !== undefined && before !== lane) crossing.add(chat.id);
    }
  useEffect(() => {
    lanes.current = new Map(LANES.flatMap((lane) => board[lane].map((chat) => [chat.id, lane])));
  });
  const processes = new Map(
    (reading.current?.chats ?? []).map((chat) => [chat.chat_id, chat] as const),
  );

  return (
    <main className="setup-shell g-root dashboard-screen" data-testid="dashboard-screen">
      <div className="setup-drag" data-tauri-drag-region="" />
      <div className="dashboard-page">
        <header className="dashboard-bar">
          <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to chats
          </button>
        </header>
        <div className="dashboard-head">
          <h1>Dashboard</h1>
          <p data-testid="dashboard-summary">{boardSummary(board)}</p>
        </div>
        {error !== null ? (
          <p role="alert" className="ui-error dashboard-message">
            {error}
          </p>
        ) : null}
        <p role="status" className="dashboard-message">
          {notice}
        </p>
        <LayoutGroup>
          <div className="dashboard-board">
            {LANES.map((lane) => (
              <section
                key={lane}
                className="dashboard-lane"
                data-lane={lane}
                aria-labelledby={`dashboard-lane-${lane}`}
                data-testid="dashboard-lane"
              >
                <h2 id={`dashboard-lane-${lane}`} className="dashboard-lane-title">
                  <LaneMark lane={lane} busy={board[lane].length > 0} />
                  {LANE_TITLES[lane]}{" "}
                  <span className="dashboard-lane-count">{board[lane].length}</span>
                </h2>
                {board[lane].length === 0 ? (
                  <p className="dashboard-lane-empty">{EMPTY[lane]}</p>
                ) : null}
                <ul className="dashboard-cards">
                  <AnimatePresence initial={false}>
                    {board[lane].map((chat) => (
                      <DashboardCard
                        key={chat.id}
                        chat={chat}
                        lane={lane}
                        crossing={crossing.has(chat.id)}
                        processes={processes.get(chat.id)}
                        reading={reading}
                        now={now}
                        reduced={reduced}
                        stopping={stopping}
                        onStop={stop}
                        onOpenChat={onOpenChat}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}
          </div>
        </LayoutGroup>
      </div>
    </main>
  );
}

/** Beside a lane's title: a volt dot, the working loader while agents work, or a check. */
function LaneMark({ lane, busy }: { readonly lane: Lane; readonly busy: boolean }) {
  return (
    <span className="dashboard-lane-mark" data-busy={busy ? "" : undefined} aria-hidden="true">
      {lane === "attention" ? (
        <StatusDot tone={busy ? "volt" : "neutral"} size={8} />
      ) : lane === "working" ? (
        busy ? (
          <PixelLoader size={12} tempo="tool" />
        ) : (
          <StatusDot tone="neutral" size={8} />
        )
      ) : (
        <Check size={14} />
      )}
    </span>
  );
}

function markState(chat: ChatSummary, lane: Lane) {
  if (lane === "attention") return chat.needs_attention ? "waiting" : "error";
  if (lane === "working") return "tool";
  return chat.status === "ready" ? "done" : "idle";
}

function DashboardCard({
  chat,
  lane,
  crossing,
  processes,
  reading,
  now,
  reduced,
  stopping,
  onStop,
  onOpenChat,
}: {
  readonly chat: ChatSummary;
  readonly lane: Lane;
  /** Its lane changed with this render: it rides above the cards it passes. */
  readonly crossing: boolean;
  readonly processes: ChatProcesses | undefined;
  readonly reading: Reading;
  readonly now: number;
  readonly reduced: boolean;
  readonly stopping: ReadonlySet<number>;
  readonly onStop: (chatId: string, pid: number, name: string) => void;
  readonly onOpenChat: (chatId: string) => void;
}) {
  const title = chat.title ?? "New chat";
  const tasks = orderedTasks(processes?.tasks ?? []).filter((task) => task.status === "running");
  const rows = (processes?.agents ?? []).flatMap((agent) => listTree(agent.processes));
  const memory = rows.reduce((sum, { row }) => sum + (row.memory_bytes ?? 0), 0);
  const line = stateLine(chat);
  const moving = useRef<HTMLLIElement>(null);
  const motionProps = reduced
    ? { layout: false as const, transition: { duration: 0 } }
    : {
        layout: "position" as const,
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98 },
        transition: springs.smooth,
        // A card crossing lanes rides above the others, solid, until it lands.
        onLayoutAnimationStart: () => {
          if (crossing) moving.current?.setAttribute("data-moving", "");
        },
        onLayoutAnimationComplete: () => moving.current?.removeAttribute("data-moving"),
      };
  return (
    <motion.li
      ref={moving}
      layoutId={reduced ? undefined : `dashboard-${chat.id}`}
      className="dashboard-card"
      data-lane={lane}
      data-testid="dashboard-card"
      data-test-chat-id={chat.id}
      {...motionProps}
    >
      <div className="dashboard-card-head">
        <AgentMark agent={chat.agent_id} size={28} state={markState(chat, lane)} label={line} />
        <div className="dashboard-card-text">
          <h3 className="dashboard-card-title">
            <button
              type="button"
              className="dashboard-card-open"
              title={`${title}\n${chat.folder}`}
              onClick={() => onOpenChat(chat.id)}
            >
              {title}
            </button>
          </h3>
          <p className="dashboard-card-meta">
            {chat.agent_name} · {projectName(chat.folder)}
          </p>
        </div>
        <ChevronRight className="dashboard-card-go" size={14} aria-hidden="true" />
      </div>
      <p className="dashboard-card-state" data-testid="dashboard-card-state">
        <span>{line}</span>
        {lane === "working" ? null : (
          <span className="dashboard-card-time"> · {ago(chat.updated_at, now)}</span>
        )}
      </p>
      {tasks.length > 0 ? (
        <ul className="dashboard-tasks" aria-label="Running tasks">
          {tasks.slice(0, TASKS_SHOWN).map((task, order) => {
            const item = { task, steps: [], endedIn: null, order, placeholder: false };
            return (
              <li key={task.task_id} className="dashboard-task" data-testid="dashboard-task">
                <TaskKindIcon kind={task.kind} />
                <span className="dashboard-task-text">
                  <span className="dashboard-task-title">{task.title}</span>
                  {task.activity ? (
                    <span className="dashboard-task-activity">{task.activity}</span>
                  ) : null}
                </span>
                <span className="dashboard-task-facts">
                  {taskFacts(item, task.status, now, true).join(" · ")}
                </span>
                <TaskMark display={task.status} />
              </li>
            );
          })}
          {tasks.length > TASKS_SHOWN ? (
            <li className="dashboard-task-more">{tasks.length - TASKS_SHOWN} more running</li>
          ) : null}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <details className="dashboard-programs" data-testid="dashboard-programs">
          <summary>
            {rows.length} {rows.length === 1 ? "program" : "programs"}
            {memory > 0 ? (
              <span className="dashboard-programs-facts"> · {formatBytes(memory)}</span>
            ) : null}
          </summary>
          <ul className="dashboard-process-list" aria-label={`Programs of ${title}`}>
            {rows.map(({ row, depth, root }) => {
              const cpu = reading.current
                ? cpuPercent(reading.previous, reading.current, row.pid)
                : null;
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
                  className="dashboard-process"
                  data-depth={Math.min(depth, 4)}
                  data-testid="process-row"
                >
                  <div className="dashboard-process-text">
                    <span className="dashboard-process-name">{row.name}</span>
                    <span className="dashboard-process-facts">{facts.join(" · ")}</span>
                    {row.command ? (
                      <code className="dashboard-process-command" title={row.command}>
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
                      onClick={() => onStop(chat.id, row.pid, row.name)}
                    >
                      <Square size={12} aria-hidden="true" /> Stop
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </motion.li>
  );
}

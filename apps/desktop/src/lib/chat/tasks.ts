import type { BackgroundTask, TaskStatus, TaskStep } from "../../bindings";
import { formatCount } from "../format";
import { formatElapsed } from "./working";

/**
 * Background tasks: the subagents and background commands an agent starts. The transcript's
 * reducer keeps each task's record and steps (`task_updated`, `task_step`) beside its items, so a
 * history page and the live stream give the same tasks; the dock's strip and the task panel read
 * them from there.
 */

/** One task as the chat knows it. */
export interface TaskItem {
  readonly task: BackgroundTask;
  /** Its steps in the order they first arrived, each replaced by its id. */
  readonly steps: readonly TaskStep[];
  /**
   * The newest turn's key when the task reported its end, so the strip keeps showing it until the
   * next turn starts; `null` while it runs.
   */
  readonly endedIn: string | null;
  /** The seq it was first heard of at, for a stable order. */
  readonly order: number;
  /** Only steps arrived so far: its record is in an older history page. Never shown. */
  readonly placeholder: boolean;
}

/** A step for a task whose record is not loaded yet: kept, but not shown until the record comes. */
function placeholderTask(taskId: string): BackgroundTask {
  return {
    task_id: taskId,
    kind: "agent",
    title: "Subagent",
    agent_type: null,
    tool_call_id: null,
    parent_task_id: null,
    backgrounded: false,
    status: "running",
    activity: null,
    tool_uses: null,
    tokens: null,
    duration_ms: null,
    started_at: null,
    ended_at: null,
    prompt: null,
    summary: null,
    summary_truncated: null,
  };
}

/** A record over what is known: `null` prompt and summary keep the ones already known. */
export function mergeTask(
  previous: TaskItem | undefined,
  task: BackgroundTask,
  order: number,
  turnKey: string | null,
): TaskItem {
  const known = previous?.placeholder === false ? previous.task : null;
  const merged: BackgroundTask = {
    ...task,
    prompt: task.prompt ?? known?.prompt ?? null,
    summary: task.summary ?? known?.summary ?? null,
    summary_truncated:
      task.summary !== null ? task.summary_truncated : (known?.summary_truncated ?? null),
  };
  const ended = merged.status !== "running";
  return {
    task: merged,
    steps: previous?.steps ?? [],
    endedIn: ended ? (previous?.endedIn ?? turnKey) : null,
    order: previous?.order ?? order,
    placeholder: false,
  };
}

/** Adds the step, or replaces the one with its id in place. */
export function withStep(
  previous: TaskItem | undefined,
  taskId: string,
  step: TaskStep,
  order: number,
): TaskItem {
  const item: TaskItem = previous ?? {
    task: placeholderTask(taskId),
    steps: [],
    endedIn: null,
    order,
    placeholder: true,
  };
  const index = item.steps.findIndex((known) => known.step_id === step.step_id);
  const steps =
    index < 0
      ? [...item.steps, step]
      : item.steps.map((known, at) => (at === index ? step : known));
  return { ...item, steps };
}

/**
 * What a task's mark shows: its own status, or stopped when it says it runs but nothing will end
 * it: the session has no process, or the live session does not know it (it ran in an earlier one).
 */
export function taskDisplay(
  item: TaskItem,
  live: boolean,
  liveTasks: ReadonlySet<string>,
): TaskStatus {
  if (item.task.status !== "running") return item.task.status;
  return live && liveTasks.has(item.task.task_id) ? "running" : "stopped";
}

/** How long the task has run (still running: until `now`), or `null` when nothing says. */
export function taskElapsed(task: BackgroundTask, display: TaskStatus, now: number): number | null {
  if (display === "running" && task.started_at !== null)
    return Math.max(now - task.started_at, task.duration_ms ?? 0);
  if (task.duration_ms !== null) return task.duration_ms;
  if (task.started_at !== null && task.ended_at !== null)
    return Math.max(0, task.ended_at - task.started_at);
  return null;
}

export function elapsedLabel(ms: number | null): string | null {
  return ms === null ? null : formatElapsed(ms);
}

/** The strip's short form: "42s", "1m 13s", "2h 5m". */
export function compactElapsed(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "12 tools", "1 tool". */
export function toolUsesLabel(count: number | null): string | null {
  if (count === null) return null;
  return `${formatCount(count)} ${count === 1 ? "tool" : "tools"}`;
}

/** "48.2k tokens". */
export function taskTokensLabel(count: number | null): string | null {
  return count === null ? null : `${formatCount(count)} tokens`;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** The key of the newest turn segment, which a task that ends now ends in. */
export function newestTurnKey(
  segments: readonly { readonly key: string; readonly turnId: string | null }[],
): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && segment.turnId !== null) return segment.key;
  }
  return null;
}

/** Every shown task, oldest first. */
export function shownTasks(tasks: ReadonlyMap<string, TaskItem>): TaskItem[] {
  return [...tasks.values()].filter((item) => !item.placeholder).sort((a, b) => a.order - b.order);
}

/**
 * What the dock's strip lists: the tasks no other task started that run now, and those that ended
 * in the newest turn. A task left running by an earlier process is not listed.
 */
export function stripTasks(
  tasks: ReadonlyMap<string, TaskItem>,
  turnKey: string | null,
  live: boolean,
  liveTasks: ReadonlySet<string>,
): TaskItem[] {
  return shownTasks(tasks).filter((item) => {
    if (item.task.parent_task_id !== null && tasks.has(item.task.parent_task_id)) return false;
    if (taskDisplay(item, live, liveTasks) === "running") return true;
    return item.task.status !== "running" && item.endedIn !== null && item.endedIn === turnKey;
  });
}

/** The tasks `parentId` started, oldest first. */
export function childTasks(tasks: ReadonlyMap<string, TaskItem>, parentId: string): TaskItem[] {
  return shownTasks(tasks).filter((item) => item.task.parent_task_id === parentId);
}

/** The task each transcript tool call started, by the call's id. */
export function tasksByToolCall(tasks: ReadonlyMap<string, TaskItem>): ReadonlyMap<string, string> {
  const byCall = new Map<string, string>();
  for (const item of tasks.values()) {
    if (!item.placeholder && item.task.tool_call_id !== null)
      byCall.set(item.task.tool_call_id, item.task.task_id);
  }
  return byCall;
}

/**
 * The words a screen reader hears once when a task ends: "Map account switching code finished".
 */
export function endedAnnouncement(task: BackgroundTask, display: TaskStatus): string | null {
  switch (display) {
    case "completed":
      return `${task.title} finished`;
    case "failed":
      return `${task.title} failed`;
    case "stopped":
      return `${task.title} stopped`;
    case "running":
      return null;
  }
}

/**
 * The task's last text step, when it repeats the summary: the summary shows it once, in full.
 */
export function repeatsSummary(step: TaskStep | undefined, summary: string | null): boolean {
  if (step?.kind !== "text" || summary === null || step.text === null) return false;
  const text = step.text.trim();
  const report = summary.trim();
  return text.length > 0 && (report.startsWith(text) || text.startsWith(report));
}

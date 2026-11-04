import { describe, expect, it } from "vitest";
import type { BackgroundTask, ProcessesSnapshot, ProcessRow } from "../bindings";
import {
  cpuPercent,
  formatBytes,
  formatUptime,
  listTree,
  orderedTasks,
  processCount,
} from "./processes";

const row = (pid: number, parent: number | null, extra: Partial<ProcessRow> = {}): ProcessRow => ({
  pid,
  parent,
  name: `p${pid}.exe`,
  command: null,
  started_ms: 1_000,
  cpu_ms: 0,
  memory_bytes: null,
  ...extra,
});

const snapshot = (taken: number, rows: ProcessRow[]): ProcessesSnapshot => ({
  taken_at_ms: taken,
  chats: [{ chat_id: "c", tasks: [], agents: [{ pid: rows[0]?.pid ?? 0, processes: rows }] }],
});

describe("the process tree", () => {
  it("lists each process before what it started, and an orphan under the agent", () => {
    const listed = listTree([row(10, null), row(11, 10), row(13, 11), row(12, 10), row(20, 99)]);
    expect(listed.map(({ row, depth }) => [row.pid, depth])).toEqual([
      [10, 0],
      [11, 1],
      [13, 2],
      [12, 1],
      [20, 1],
    ]);
    expect(listed.map((entry) => entry.root)).toEqual([true, false, false, false, false]);
    expect(listTree([])).toEqual([]);
  });
});

describe("processor use", () => {
  it("is the processor time gained over the time between two readings", () => {
    const before = snapshot(10_000, [row(10, null, { cpu_ms: 500 })]);
    const after = snapshot(12_000, [row(10, null, { cpu_ms: 1_500 })]);
    expect(cpuPercent(before, after, 10)).toBe(50);
    expect(cpuPercent(null, after, 10)).toBeNull();
    expect(cpuPercent(before, after, 11)).toBeNull();
    // Two readings a moment apart (a double refresh) measure nothing.
    const soon = snapshot(10_050, [row(10, null, { cpu_ms: 600 })]);
    expect(cpuPercent(before, soon, 10)).toBeNull();
  });

  it("is unknown for a recycled id or a process the system would not measure", () => {
    const before = snapshot(10_000, [row(10, null, { cpu_ms: 500 })]);
    const recycled = snapshot(12_000, [row(10, null, { cpu_ms: 900, started_ms: 11_000 })]);
    expect(cpuPercent(before, recycled, 10)).toBeNull();
    const unmeasured = snapshot(12_000, [row(10, null, { cpu_ms: null })]);
    expect(cpuPercent(before, unmeasured, 10)).toBeNull();
  });
});

describe("the page's words", () => {
  it("reads sizes and run times plainly", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(300)).toBe("1 KB");
    expect(formatBytes(45 * 1024 * 1024)).toBe("45 MB");
    expect(formatBytes(3.25 * 1024 ** 3)).toBe("3.3 GB");
    const now = 1_000_000_000;
    expect(formatUptime(null, now)).toBeNull();
    expect(formatUptime(now - 42_000, now)).toBe("42s");
    expect(formatUptime(now - 3 * 60_000, now)).toBe("3m");
    expect(formatUptime(now - 65 * 60_000, now)).toBe("1h 5m");
    expect(formatUptime(now - 51 * 3_600_000, now)).toBe("2d 3h");
  });

  it("puts running tasks first, then the newest", () => {
    const task = (id: string, status: BackgroundTask["status"], started_at: number) =>
      ({ task_id: id, status, started_at }) as BackgroundTask;
    const ordered = orderedTasks([
      task("old", "completed", 1),
      task("run", "running", 2),
      task("new", "stopped", 3),
    ]);
    expect(ordered.map((t) => t.task_id)).toEqual(["run", "new", "old"]);
  });

  it("counts every listed process", () => {
    expect(processCount(null)).toBe(0);
    expect(processCount(snapshot(1, [row(10, null), row(11, 10)]))).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import type { LineEditBucket } from "../bindings";
import {
  agentLabel,
  agentsOf,
  calendarOf,
  calendarStart,
  dayKey,
  dayLabel,
  formatDay,
  formatLines,
  formatStreak,
  WEEKS,
} from "./lineEdits";

/** Friday, 20 November 2026, mid-afternoon, in the local zone. */
const NOW = new Date(2026, 10, 20, 15, 30).getTime();

const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

const bucket = (agent: string, time: number, lines: number): LineEditBucket => ({
  agent,
  at: time,
  lines,
});

describe("the calendar's days", () => {
  it("runs from a Sunday 52 weeks before this week's to today", () => {
    const start = calendarStart(NOW);
    expect(start.getDay()).toBe(0);
    expect(dayKey(start)).toBe("2025-11-16");
    const calendar = calendarOf([], null, NOW);
    expect(calendar.days).toHaveLength((WEEKS - 1) * 7 + 6);
    const last = calendar.days[calendar.days.length - 1];
    if (last === undefined) throw new Error("the calendar has no days");
    expect(dayKey(last.date)).toBe("2026-11-20");
    expect(last.week).toBe(WEEKS - 1);
    expect(last.weekday).toBe(5);
    expect(calendar.total).toBe(0);
    expect(calendar.mostActiveMonth).toBeNull();
    expect(calendar.mostActiveDay).toBeNull();
  });

  it("puts each quarter hour in its local day and sums one agent or all", () => {
    const buckets = [
      bucket("claude", at(2026, 8, 29, 0), 100),
      bucket("codex", at(2026, 8, 29, 23), 50),
      bucket("claude", at(2026, 8, 30, 0), 7),
      // Before the calendar: left out.
      bucket("claude", at(2025, 11, 1), 1000),
    ];
    const all = calendarOf(buckets, null, NOW);
    expect(all.total).toBe(157);
    const day = all.days.find((entry) => dayKey(entry.date) === "2026-08-29");
    expect(day?.lines).toBe(150);
    const codex = calendarOf(buckets, "codex", NOW);
    expect(codex.total).toBe(50);
    expect(codex.mostActiveDay && formatDay(codex.mostActiveDay)).toBe("Aug 29, 2026");
  });

  it("lights the busiest day fully and the rest by quarter of the active days", () => {
    const buckets = [10, 20, 30, 40, 50, 60, 70, 1000].map((lines, index) =>
      bucket("claude", at(2026, 9, 1 + index), lines),
    );
    const levels = calendarOf(buckets, null, NOW)
      .days.filter((day) => day.lines > 0)
      .map((day) => day.level);
    expect(levels).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const single = calendarOf([bucket("claude", at(2026, 9, 1), 3)], null, NOW);
    expect(single.days.find((day) => day.lines > 0)?.level).toBe(4);
    expect(single.days.filter((day) => day.level === 0)).toHaveLength(single.days.length - 1);
  });
});

describe("the calendar's figures", () => {
  it("names the busiest month and day and counts the streaks", () => {
    const buckets = [
      ...Array.from({ length: 24 }, (_, index) => bucket("claude", at(2026, 8, 6 + index), 10)),
      bucket("claude", at(2026, 8, 29), 500),
      bucket("claude", at(2026, 10, 3), 600),
    ];
    const calendar = calendarOf(buckets, null, NOW);
    expect(calendar.mostActiveMonth).toBe("August");
    expect(calendar.mostActiveDay && formatDay(calendar.mostActiveDay)).toBe("Oct 3, 2026");
    expect(calendar.longestStreak).toBe(24);
    expect(calendar.currentStreak).toBe(0);
  });

  it("keeps a streak that reached yesterday current while today has no edits yet", () => {
    const yesterday = calendarOf(
      [bucket("claude", at(2026, 11, 18), 1), bucket("claude", at(2026, 11, 19), 1)],
      null,
      NOW,
    );
    expect(yesterday.currentStreak).toBe(2);
    const today = calendarOf(
      [bucket("claude", at(2026, 11, 19), 1), bucket("claude", at(2026, 11, 20), 1)],
      null,
      NOW,
    );
    expect(today.currentStreak).toBe(2);
    const broken = calendarOf([bucket("claude", at(2026, 11, 18), 1)], null, NOW);
    expect(broken.currentStreak).toBe(0);
  });

  it("names the year when the busiest month's name shows twice", () => {
    const calendar = calendarOf([bucket("claude", at(2026, 11, 2), 40)], null, NOW);
    expect(calendar.mostActiveMonth).toBe("November 2026");
  });

  it("labels each month over its first Sunday and drops a first label crowded by the next", () => {
    const months = calendarOf([], null, NOW).months;
    expect(months[0]).toEqual({ name: "Nov", week: 0 });
    expect(months[1]).toEqual({ name: "Dec", week: 3 });
    expect(months[months.length - 1]).toEqual({ name: "Nov", week: 50 });
    // The calendar of 2 December starts on Sunday 30 November 2025: December's first Sunday is a
    // week on, too close for November's label.
    const crowded = calendarOf([], null, new Date(2026, 11, 2, 9).getTime()).months;
    expect(crowded[0]).toEqual({ name: "Dec", week: 1 });
  });
});

describe("words", () => {
  it("formats totals, streaks and the square's label", () => {
    expect(formatLines(643741)).toBe("643,741");
    expect(formatStreak(1)).toBe("1 day");
    expect(formatStreak(24)).toBe("24 days");
    expect(dayLabel({ date: new Date(2026, 7, 29), lines: 1204 })).toBe(
      "1,204 line edits on Saturday, August 29, 2026",
    );
    expect(dayLabel({ date: new Date(2026, 7, 30), lines: 1 })).toBe(
      "1 line edit on Sunday, August 30, 2026",
    );
    expect(dayLabel({ date: new Date(2026, 7, 31), lines: 0 })).toBe(
      "No line edits on Monday, August 31, 2026",
    );
  });

  it("lists agents with edits, the most first, by the names their chats show", () => {
    const buckets = [
      bucket("codex", 1, 5),
      bucket("claude", 2, 9),
      bucket("pi", 3, 0),
      bucket("", 4, 1),
    ];
    expect(agentsOf(buckets)).toEqual(["claude", "codex", ""]);
    const names = new Map([["claude", "Claude Code"]]);
    expect(agentLabel("claude", names)).toBe("Claude Code");
    expect(agentLabel("codex", names)).toBe("Codex");
    expect(agentLabel("someagent", names)).toBe("someagent");
    expect(agentLabel("", names)).toBe("Other");
  });
});

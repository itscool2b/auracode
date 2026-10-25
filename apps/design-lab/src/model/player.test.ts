import { describe, expect, it } from "vitest";
import {
  advance,
  clampSpeed,
  MAX_SPEED,
  MIN_SPEED,
  type PlaybackOptions,
  PlayerClock,
} from "./player";

const once: PlaybackOptions = { duration: 10_000, speed: 1, loop: false, loopPauseMs: 0 };
const looping: PlaybackOptions = { duration: 10_000, speed: 1, loop: true, loopPauseMs: 2_000 };

/** A wall clock the test moves by hand. */
function fakeNow(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe("clampSpeed", () => {
  it("keeps sane speeds and repairs the rest", () => {
    expect(clampSpeed(2)).toBe(2);
    expect(clampSpeed(0.5)).toBe(0.5);
    expect(clampSpeed(100)).toBe(MAX_SPEED);
    expect(clampSpeed(0.01)).toBe(MIN_SPEED);
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed(-3)).toBe(1);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });
});

describe("advance", () => {
  it("plays in real time and stops at the end without a loop", () => {
    expect(advance(0, 4_000, once)).toEqual({ time: 4_000, iteration: 0, atEnd: false });
    expect(advance(0, 10_000, once)).toEqual({ time: 10_000, iteration: 0, atEnd: true });
    expect(advance(0, 60_000, once)).toEqual({ time: 10_000, iteration: 0, atEnd: true });
    expect(advance(3_000, 1_000, once).time).toBe(4_000);
  });

  it("scales by speed", () => {
    expect(advance(0, 2_000, { ...once, speed: 2 }).time).toBe(4_000);
    expect(advance(0, 2_000, { ...once, speed: 0.5 }).time).toBe(1_000);
  });

  it("holds the end for the pause, in wall time, then starts over", () => {
    expect(advance(0, 11_000, looping)).toEqual({ time: 10_000, iteration: 0, atEnd: true });
    expect(advance(0, 12_000, looping)).toEqual({ time: 0, iteration: 1, atEnd: false });
    expect(advance(0, 15_000, looping)).toEqual({ time: 3_000, iteration: 1, atEnd: false });
    // At 2x the timeline takes 5 s, and the pause still lasts 2 s.
    const fast = { ...looping, speed: 2 };
    expect(advance(0, 6_000, fast)).toMatchObject({ time: 10_000, atEnd: true });
    expect(advance(0, 7_000, fast)).toMatchObject({ time: 0, iteration: 1 });
  });

  it("survives nonsense", () => {
    expect(advance(-50, -10, once)).toEqual({ time: 0, iteration: 0, atEnd: false });
    expect(advance(Number.NaN, Number.NaN, once).time).toBe(0);
    expect(advance(50_000, 0, once).time).toBe(10_000);
    expect(advance(0, 1_000, { ...looping, duration: 0 })).toEqual({
      time: 0,
      iteration: 0,
      atEnd: true,
    });
  });
});

describe("PlayerClock", () => {
  it("plays from the start and stops itself at the end of a timeline that does not loop", () => {
    const clock = fakeNow();
    const player = new PlayerClock(once, { now: clock.now });
    expect(player.playing).toBe(true);
    clock.tick(2_500);
    expect(player.time()).toBe(2_500);
    clock.tick(20_000);
    expect(player.time()).toBe(10_000);
    expect(player.playing).toBe(false);
    // Play at the end starts over.
    player.play();
    expect(player.time()).toBe(0);
    expect(player.playing).toBe(true);
  });

  it("holds a frozen start until played", () => {
    const clock = fakeNow();
    const player = new PlayerClock(once, { now: clock.now, startAt: 7_500, playing: false });
    clock.tick(5_000);
    expect(player.time()).toBe(7_500);
    expect(player.playing).toBe(false);
    player.play();
    clock.tick(1_000);
    expect(player.time()).toBe(8_500);
  });

  it("pauses and resumes where it was", () => {
    const clock = fakeNow();
    const player = new PlayerClock(once, { now: clock.now });
    clock.tick(3_000);
    player.pause();
    clock.tick(10_000);
    expect(player.time()).toBe(3_000);
    player.play();
    clock.tick(1_000);
    expect(player.time()).toBe(4_000);
  });

  it("seeks within the timeline, playing or paused", () => {
    const clock = fakeNow();
    const player = new PlayerClock(once, { now: clock.now });
    player.seek(6_000);
    clock.tick(500);
    expect(player.time()).toBe(6_500);
    player.pause();
    player.seek(-100);
    expect(player.time()).toBe(0);
    player.seek(99_000);
    expect(player.time()).toBe(10_000);
  });

  it("changes speed without moving the playhead", () => {
    const clock = fakeNow();
    const player = new PlayerClock(once, { now: clock.now });
    clock.tick(2_000);
    player.setSpeed(4);
    expect(player.time()).toBe(2_000);
    expect(player.speed).toBe(4);
    clock.tick(1_000);
    expect(player.time()).toBe(6_000);
  });

  it("loops forever when asked", () => {
    const clock = fakeNow();
    const player = new PlayerClock(looping, { now: clock.now });
    clock.tick(12_500);
    expect(player.time()).toBe(500);
    expect(player.playing).toBe(true);
    player.pause();
    clock.tick(5_000);
    expect(player.time()).toBe(500);
  });

  it("clamps its start and repairs a bad duration", () => {
    const clock = fakeNow();
    expect(new PlayerClock(once, { now: clock.now, startAt: 99_000 }).time()).toBe(10_000);
    const broken = new PlayerClock({ ...once, duration: Number.NaN }, { now: clock.now });
    expect(broken.duration).toBe(0);
    expect(broken.time()).toBe(0);
  });
});

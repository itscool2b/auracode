import { describe, expect, it } from "vitest";
import { playbackFor } from "./playback";
import { type LabRoute, parseRoute, type StageLink, stageHref } from "./route";

const DIRECTIONS = ["aurora", "noir", "halo"];
const parse = (hash: string): LabRoute => parseRoute(hash, DIRECTIONS);

describe("parseRoute", () => {
  it("shows the gallery for an empty path", () => {
    for (const hash of ["", "#", "#/", "#//", "/", "#/?t=3"]) {
      expect(parse(hash)).toEqual({ kind: "gallery" });
    }
  });

  it("opens a direction in streaming by default, with every param at its default", () => {
    expect(parse("#/aurora")).toEqual({
      kind: "stage",
      direction: "aurora",
      state: "streaming",
      t: null,
      speed: 1,
      reducedMotion: false,
      play: null,
      hud: null,
      wallpaper: "dusk",
      thumb: false,
    });
    expect(parse("#/noir/")).toMatchObject({ direction: "noir", state: "streaming" });
  });

  it("reads every param", () => {
    expect(
      parse("#/halo/permission?t=7.5&speed=2&motion=reduce&play=1&hud=0&wall=dawn&thumb=1"),
    ).toEqual({
      kind: "stage",
      direction: "halo",
      state: "permission",
      t: 7.5,
      speed: 2,
      reducedMotion: true,
      play: true,
      hud: false,
      wallpaper: "dawn",
      thumb: true,
    });
  });

  it("repairs or ignores bad params", () => {
    expect(parse("#/aurora/settled?t=abc")).toMatchObject({ t: null });
    expect(parse("#/aurora/settled?t=")).toMatchObject({ t: null });
    expect(parse("#/aurora/settled?t=-4")).toMatchObject({ t: 0 });
    expect(parse("#/aurora/settled?speed=0")).toMatchObject({ speed: 1 });
    expect(parse("#/aurora/settled?speed=fast")).toMatchObject({ speed: 1 });
    expect(parse("#/aurora/settled?speed=99")).toMatchObject({ speed: 16 });
    expect(parse("#/aurora/settled?motion=REDUCE")).toMatchObject({ reducedMotion: true });
    expect(parse("#/aurora/settled?motion=full")).toMatchObject({ reducedMotion: false });
    expect(parse("#/aurora/settled?play=maybe&hud=true")).toMatchObject({ play: null, hud: true });
    expect(parse("#/aurora/settled?wall=plaid")).toMatchObject({ wallpaper: "dusk" });
  });

  it("explains what is missing", () => {
    expect(parse("#/vapor/settled")).toEqual({
      kind: "not-found",
      message: 'There is no direction called "vapor".',
    });
    expect(parse("#/aurora/sleeping")).toEqual({
      kind: "not-found",
      message: 'There is no state called "sleeping".',
    });
    expect(parse("#/aurora/settled/extra")).toMatchObject({ kind: "not-found" });
    // Object members are not directions.
    expect(parse("#/constructor")).toMatchObject({ kind: "not-found" });
  });

  it("decodes path segments, and survives bad escapes", () => {
    expect(parseRoute("#/my%20dir/settled", ["my dir"])).toMatchObject({ direction: "my dir" });
    expect(parse("#/%E0%A4%A/settled")).toMatchObject({ kind: "not-found" });
  });
});

describe("stageHref", () => {
  it("leaves defaults out", () => {
    expect(stageHref({ direction: "aurora", state: "streaming" })).toBe("#/aurora/streaming");
    expect(
      stageHref({
        direction: "aurora",
        state: "settled",
        t: null,
        speed: 1,
        reducedMotion: false,
        play: null,
        hud: null,
        wallpaper: "dusk",
        thumb: false,
      }),
    ).toBe("#/aurora/settled");
  });

  it("round-trips through parseRoute", () => {
    const links: StageLink[] = [
      { direction: "noir", state: "streaming", t: 24 },
      { direction: "halo", state: "picker", speed: 0.5, reducedMotion: true },
      { direction: "aurora", state: "permission", play: false, hud: true, wallpaper: "graphite" },
      { direction: "aurora", state: "empty", thumb: true, t: 0 },
    ];
    for (const link of links) {
      const route = parse(stageHref(link));
      expect(route).toMatchObject({ kind: "stage", ...link });
    }
  });
});

describe("playbackFor", () => {
  const duration = 48_300;

  it("plays the streaming state from the start, looping", () => {
    expect(playbackFor({ t: null, play: null }, "loop", duration)).toEqual({
      startAt: 0,
      autoplay: true,
      loop: true,
    });
    expect(playbackFor({ t: null, play: false }, "loop", duration)).toMatchObject({
      startAt: 0,
      autoplay: false,
    });
  });

  it("freezes any state at t, clamped to the recording", () => {
    expect(playbackFor({ t: 7.5, play: null }, "loop", duration)).toEqual({
      startAt: 7_500,
      autoplay: false,
      loop: true,
    });
    expect(playbackFor({ t: 999, play: null }, "end", duration)).toMatchObject({
      startAt: duration,
      autoplay: false,
    });
    expect(playbackFor({ t: 3, play: true }, "end", duration)).toEqual({
      startAt: 3_000,
      autoplay: true,
      loop: true,
    });
  });

  it("holds the other states at their end unless told to play", () => {
    expect(playbackFor({ t: null, play: null }, "end", duration)).toEqual({
      startAt: duration,
      autoplay: false,
      loop: false,
    });
    expect(playbackFor({ t: null, play: true }, "end", duration)).toEqual({
      startAt: 0,
      autoplay: true,
      loop: true,
    });
  });
});

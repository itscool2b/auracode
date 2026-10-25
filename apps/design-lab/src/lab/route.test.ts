import { describe, expect, it } from "vitest";
import { playbackFor } from "./playback";
import { type LabRoute, parseRoute, type RouteDirection, type StageLink, stageHref } from "./route";
import { LAB_STATES } from "./states";

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
      theme: "dark",
      thumb: false,
    });
    expect(parse("#/noir/")).toMatchObject({ direction: "noir", state: "streaming" });
  });

  it("reads every param", () => {
    expect(
      parse(
        "#/halo/permission?t=7.5&speed=2&motion=reduce&play=1&hud=0&wall=dawn&theme=light&thumb=1",
      ),
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
      theme: "light",
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
    expect(parse("#/aurora/settled?theme=LIGHT")).toMatchObject({ theme: "light" });
    expect(parse("#/aurora/settled?theme=sepia")).toMatchObject({ theme: "dark" });
    expect(parse("#/aurora/settled?theme=")).toMatchObject({ theme: "dark" });
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

  it("opens only the states a direction renders, its first one by default", () => {
    const directions: RouteDirection[] = [
      { id: "aurora" },
      { id: "orbit", states: [...LAB_STATES], wallpaper: "graphite" },
      { id: "solo", states: ["settled", "picker"] },
    ];
    const open = (hash: string): LabRoute => parseRoute(hash, directions);
    expect(open("#/orbit/changes")).toMatchObject({ kind: "stage", state: "changes" });
    expect(open("#/orbit/onboarding?t=1.6")).toMatchObject({ state: "onboarding", t: 1.6 });
    // A bare id means the core states.
    expect(open("#/aurora/changes")).toEqual({
      kind: "not-found",
      message: 'The aurora direction has no "changes" state.',
    });
    expect(parse("#/noir/onboarding")).toMatchObject({ kind: "not-found" });
    expect(open("#/solo")).toMatchObject({ kind: "stage", state: "settled" });
    expect(open("#/solo/streaming")).toMatchObject({ kind: "not-found" });
    expect(open("#/orbit/sleeping")).toEqual({
      kind: "not-found",
      message: 'There is no state called "sleeping".',
    });
  });

  it("opens a direction on its own wallpaper unless the URL names one", () => {
    const directions: RouteDirection[] = [{ id: "aurora" }, { id: "orbit", wallpaper: "graphite" }];
    const open = (hash: string): LabRoute => parseRoute(hash, directions);
    expect(open("#/orbit/settled")).toMatchObject({ wallpaper: "graphite" });
    expect(open("#/orbit/settled?wall=dusk")).toMatchObject({ wallpaper: "dusk" });
    expect(open("#/orbit/settled?wall=plaid")).toMatchObject({ wallpaper: "graphite" });
    expect(open("#/aurora/settled")).toMatchObject({ wallpaper: "dusk" });
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
        theme: "dark",
        thumb: false,
      }),
    ).toBe("#/aurora/settled");
    expect(stageHref({ direction: "orbit", state: "settled", theme: "light" })).toBe(
      "#/orbit/settled?theme=light",
    );
  });

  it("leaves out the wallpaper the direction would pick anyway, and keeps any other", () => {
    expect(
      stageHref({
        direction: "orbit",
        state: "settled",
        wallpaper: "graphite",
        defaultWallpaper: "graphite",
      }),
    ).toBe("#/orbit/settled");
    expect(
      stageHref({
        direction: "orbit",
        state: "settled",
        wallpaper: "dusk",
        defaultWallpaper: "graphite",
      }),
    ).toBe("#/orbit/settled?wall=dusk");
    const directions: RouteDirection[] = [
      { id: "orbit", states: [...LAB_STATES], wallpaper: "graphite" },
    ];
    for (const wallpaper of ["dusk", "dawn", "graphite"] as const) {
      const href = stageHref({
        direction: "orbit",
        state: "changes",
        wallpaper,
        defaultWallpaper: "graphite",
        theme: "light",
      });
      expect(parseRoute(href, directions)).toMatchObject({
        kind: "stage",
        state: "changes",
        wallpaper,
        theme: "light",
      });
    }
  });

  it("round-trips through parseRoute", () => {
    const links: StageLink[] = [
      { direction: "noir", state: "streaming", t: 24 },
      { direction: "halo", state: "picker", speed: 0.5, reducedMotion: true },
      { direction: "aurora", state: "permission", play: false, hud: true, wallpaper: "graphite" },
      { direction: "aurora", state: "empty", thumb: true, t: 0 },
      { direction: "noir", state: "settled", theme: "light" },
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { playNotice, setNoticeSoundsAvailable } from "./sounds";

/** Enough of Web Audio for one notice: counts the contexts made and the tones started. */
function fakeAudio() {
  const made = { contexts: 0, tones: 0 };
  const param = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    constructor() {
      made.contexts += 1;
    }
    resume() {
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: "",
        frequency: param,
        connect: (next: unknown) => next,
        start: () => {
          made.tones += 1;
        },
        stop() {},
      };
    }
    createGain() {
      return { gain: param, connect: (next: unknown) => next };
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return made;
}

describe("notice sounds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setNoticeSoundsAvailable(false);
  });

  it("make no audio context until the window may play sound, then play each note", () => {
    const made = fakeAudio();
    // Before the app info arrives, and on Linux without GStreamer's plugins: silence, and no
    // audio context, which would take the window's page down there.
    playNotice("finished");
    expect(made).toEqual({ contexts: 0, tones: 0 });
    setNoticeSoundsAvailable(true);
    playNotice("finished");
    expect(made).toEqual({ contexts: 1, tones: 2 });
    setNoticeSoundsAvailable(false);
    playNotice("failed");
    expect(made.tones).toBe(2);
  });
});

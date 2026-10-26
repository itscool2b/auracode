import { useMemo } from "react";
import { type Player, usePlayer } from "../../kit";

/*
 * The window's clock: the lab's player, plus a second player that starts only when something
 * happens here after a recording has ended (a message sent, a command let through). A frozen frame
 * (`?t=`, or a state that holds its finished recording) never starts it, so every still renders the
 * same way; once the user acts, timers tick and scripted replies stream in real time. Time still
 * comes from a player, never the wall clock.
 */

/** Room for what happens here after a recording: six hours. */
const AFTER_MS = 6 * 60 * 60 * 1000;

export interface WindowClock extends Player {
  /** Lets time pass after the recording, when the lab's player is not moving it. */
  run(): void;
  /** Stops the clock where it is: the lab's player and the time added here. */
  halt(): void;
  /** Back to the recording alone: the time added here goes away. */
  reset(): void;
}

export function useWindowClock(player: Player): WindowClock {
  const after = usePlayer({
    duration: AFTER_MS,
    speed: 1,
    loop: false,
    startAt: 0,
    autoplay: false,
  });
  return useMemo<WindowClock>(
    () => ({
      duration: player.duration + AFTER_MS,
      speed: player.speed,
      playing: player.playing || after.playing,
      loop: player.loop,
      getTime: () => player.getTime() + after.getTime(),
      subscribe: (listener) => {
        const first = player.subscribe(listener);
        const second = after.subscribe(listener);
        return () => {
          first();
          second();
        };
      },
      play: player.play,
      pause: player.pause,
      toggle: player.toggle,
      seek: player.seek,
      setSpeed: player.setSpeed,
      run: () => {
        // The lab's player still moves the recording (and a loop's end hold does not count).
        const recording = player.playing && player.getTime() < player.duration;
        if (!recording && !after.playing) after.play();
      },
      halt: () => {
        if (player.playing) player.pause();
        if (after.playing) after.pause();
      },
      reset: () => {
        after.pause();
        after.seek(0);
      },
    }),
    [player, after],
  );
}

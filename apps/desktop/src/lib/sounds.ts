/**
 * Settings' Sounds: a short tone when a chat finishes, fails or needs you. The native shell decides
 * which chats deserve one (as it does for notifications) and sends them only while Sounds is on;
 * the window plays them, synthesized, so no audio file ships.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "./ipc";

export type NoticeSound = "finished" | "failed" | "attention";

/** Each sound's notes in hertz, one after another: rising when done, two taps, falling. */
export const NOTES: Readonly<Record<NoticeSound, readonly number[]>> = {
  finished: [659.25, 880],
  attention: [880, 880],
  failed: [523.25, 392],
};

/** Seconds between the notes' starts, and each note's length. */
const STEP = 0.13;
const LENGTH = 0.22;
/** Quiet: a cue beside the work, not an alarm. */
const LEVEL = 0.12;

let audio: AudioContext | null = null;

/**
 * Whether this window may make a sound: the app info's `media`, false until it arrives. On Linux
 * without GStreamer's plugins an audio context would take the window's page down with it.
 */
let available = false;

export function setNoticeSoundsAvailable(media: boolean): void {
  available = media;
}

export function isNoticeSound(value: unknown): value is NoticeSound {
  return value === "finished" || value === "failed" || value === "attention";
}

export function playNotice(kind: NoticeSound): void {
  if (!available || typeof AudioContext === "undefined") return;
  audio ??= new AudioContext();
  const context = audio;
  // A context made before any click starts suspended; the next one resumes it.
  if (context.state === "suspended") void context.resume().catch(() => {});
  const start = context.currentTime + 0.01;
  NOTES[kind].forEach((frequency, index) => {
    const at = start + index * STEP;
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(LEVEL, at + 0.012);
    level.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH);
    tone.connect(level).connect(context.destination);
    tone.start(at);
    tone.stop(at + LENGTH + 0.02);
  });
}

/** Plays every notice the native shell sends. */
export function subscribeNoticeSounds(): () => void {
  if (!inTauri()) return () => {};
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void listen<unknown>("auracode-chat-notice", (event) => {
    if (isNoticeSound(event.payload)) playNotice(event.payload);
  })
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {
      // A closing window hears no more notices.
    });
  // A click resumes a context the browser held back until one.
  const resume = () => {
    if (audio?.state === "suspended") void audio.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener("pointerdown", resume);
  };
}

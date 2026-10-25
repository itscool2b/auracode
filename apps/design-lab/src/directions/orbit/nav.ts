import { sceneFor } from "../../fixture/scenes";
import type { ChatSummary, LabState } from "../../kit";

/*
 * Moving between chats in the lab. Each recorded chat lives in a lab state (the pacing chat in
 * settled, or streaming while it runs; the Codex chat in permission), so opening a chat from the
 * sidebar is a change of URL that keeps the theme, the wallpaper and the motion setting. Chats with
 * no recording yet open in the window itself.
 */

/** The hash that shows another state of this direction, keeping every setting but the playhead. */
export function stateHash(current: string, direction: string, state: LabState): string {
  const raw = current.replace(/^#/, "");
  const queryStart = raw.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : raw.slice(queryStart + 1));
  // A frozen playhead or forced playback belongs to the state it was set for.
  params.delete("t");
  params.delete("play");
  const query = params.toString();
  return `#/${encodeURIComponent(direction)}/${state}${query ? `?${query}` : ""}`;
}

/**
 * The same hash with one setting changed (`theme=light`, `motion=reduce`), or removed when the
 * value is null. The path and every other setting stay.
 */
export function withParam(current: string, name: string, value: string | null): string {
  const raw = current.replace(/^#/, "");
  const queryStart = raw.indexOf("?");
  const path = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const params = new URLSearchParams(queryStart === -1 ? "" : raw.slice(queryStart + 1));
  if (value === null) params.delete(name);
  else params.set(name, value);
  const query = params.toString();
  return `#${path}${query ? `?${query}` : ""}`;
}

/**
 * The lab state that shows a chat, among the states this direction renders: a playing scene while
 * the chat runs, a held one otherwise, never one with the picker or the right panel already open.
 * Null when no state records the chat.
 */
export function stateForChat(chat: ChatSummary, states: readonly LabState[]): LabState | null {
  const plain = states.filter((state) => {
    const scene = sceneFor(state);
    return scene.chatId === chat.id && !scene.composer.pickerOpen && scene.rightPanel === null;
  });
  if (plain.length === 0) return null;
  const wanted = chat.status === "running" ? "loop" : "end";
  return plain.find((state) => sceneFor(state).playback === wanted) ?? plain[0] ?? null;
}

/** Opens another state of Orbit, keeping the URL's settings. */
export function openState(state: LabState): void {
  if (typeof window === "undefined") return;
  window.location.hash = stateHash(window.location.hash, "orbit", state);
}

/** Changes one of the lab's settings in the URL: the window re-renders with it, nothing remounts. */
export function setLabParam(name: "theme" | "motion", value: string | null): void {
  if (typeof window === "undefined") return;
  window.location.hash = withParam(window.location.hash, name, value);
}

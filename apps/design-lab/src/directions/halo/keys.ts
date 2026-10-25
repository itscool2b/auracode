/*
 * Halo's window-level keys, decided in one place. Escape closes the topmost layer first: the
 * autonomy menu, then the picker, then a pending permission (rejected), then a running turn
 * (stopped; a second Escape forces it). Enter and Cmd+Enter answer a pending permission, but never
 * while a menu is open or focus is in a text field or a menu, where the keys mean something else.
 */

/** Where keyboard focus is, as far as the window's keys care. */
export type FocusKind =
  /** The composer's message field, empty: Escape may still stop the agent. */
  | "composer-empty"
  /** The composer's message field with text in it: Escape and Enter belong to the text. */
  | "composer-text"
  /** Any other text field (the sidebar search). */
  | "field"
  /** Inside the picker or the autonomy menu. */
  | "popover"
  | "other";

export interface KeyContext {
  readonly menuOpen: boolean;
  readonly pickerOpen: boolean;
  /** A permission request is waiting for an answer. */
  readonly permissionPending: boolean;
  /** The agent is working (and has not been stopped). */
  readonly working: boolean;
  /** Stop was pressed once and the agent has not stopped yet. */
  readonly stopping: boolean;
  readonly focus: FocusKind;
}

export type EscapeAction = "close-menu" | "close-picker" | "reject" | "stop" | "force-stop";

/** What Escape does now, topmost layer first; null when it should do nothing here. */
export function escapeAction(context: KeyContext): EscapeAction | null {
  if (context.menuOpen) return "close-menu";
  if (context.pickerOpen) return "close-picker";
  // A draft or a search keeps its own Escape.
  if (context.focus === "composer-text" || context.focus === "field") return null;
  if (context.permissionPending) return "reject";
  if (context.stopping) return "force-stop";
  if (context.working) return "stop";
  return null;
}

export type EnterAction = "allow-once" | "allow-always";

/**
 * What Enter does now. Plain Enter on a focused button presses that button instead; Cmd (or Ctrl)
 * + Enter always means "always allow" when a permission is pending.
 */
export function enterAction(
  context: KeyContext,
  key: { readonly meta: boolean; readonly onButton: boolean },
): EnterAction | null {
  if (!context.permissionPending || context.menuOpen || context.pickerOpen) return null;
  if (context.focus !== "other") return null;
  if (key.meta) return "allow-always";
  return key.onButton ? null : "allow-once";
}

/** Classifies the element that has focus (or that a key event targets). */
export function focusKind(target: EventTarget | null): FocusKind {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return "other";
  if (target.closest(".halo-popover")) return "popover";
  if (target instanceof HTMLTextAreaElement && target.classList.contains("halo-input")) {
    return target.value.trim() === "" ? "composer-empty" : "composer-text";
  }
  if (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return "field";
  }
  return "other";
}

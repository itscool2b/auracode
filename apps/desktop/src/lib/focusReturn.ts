/**
 * Keyboard focus never falls to nothing (owner, 17 November 2026: after a shortcut in the
 * terminal, "I have to click back into the terminal to press another key"). When focus ends on the
 * page itself, with no control holding it, the control that held it last and is still on screen
 * takes it back: the terminal, after Settings or the Dashboard closes, after a chat switch, after
 * a palette or menu goes away, and when the window comes back to the front.
 *
 * Focus the person moved on purpose is left alone: a click on something that takes no focus (text
 * to select, the empty part of a pane) leaves focus where the click put it, and dialogs return
 * focus to whatever opened them themselves.
 */

const HISTORY = 8;
/** A focus loss this soon after a press is the press's doing. */
const PRESS_MS = 400;

export interface FocusReturn {
  /** Gives focus back if it fell to nothing; whether it did. */
  restore(): boolean;
  /** Restores once the page has painted what changed, after a view or a chat switch. */
  restoreSoon(): void;
  dispose(): void;
}

/** Whether `element` can take focus where it is now: in the page, shown, not inert or disabled. */
export function focusable(element: HTMLElement, win: Pick<Window, "getComputedStyle">): boolean {
  if (!element.isConnected) return false;
  if (element.closest("[hidden], [inert]")) return false;
  if ((element as HTMLButtonElement).disabled === true) return false;
  if (element.getClientRects().length === 0) return false;
  return win.getComputedStyle(element).visibility !== "hidden";
}

export function createFocusReturn(doc: Document = document, win: Window = window): FocusReturn {
  let recent: HTMLElement[] = [];
  let pressedAt = Number.NEGATIVE_INFINITY;
  let queued = false;
  let disposed = false;

  const empty = () => {
    const active = doc.activeElement;
    return active === null || active === doc.body || active === doc.documentElement;
  };

  const restore = (): boolean => {
    if (disposed || !empty()) return false;
    // A dialog returns focus to its opener itself.
    if (doc.querySelector("dialog[open]")) return false;
    for (const element of recent) {
      if (!focusable(element, win)) continue;
      element.focus({ preventScroll: true });
      if (doc.activeElement === element) return true;
    }
    return false;
  };

  const restoreSoon = () => {
    if (queued || disposed) return;
    queued = true;
    // After React has committed and the browser laid out what changed.
    win.requestAnimationFrame(() => {
      win.setTimeout(() => {
        queued = false;
        restore();
      }, 0);
    });
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.focus !== "function" || target === doc.body) return;
    recent = [target, ...recent.filter((element) => element !== target)].slice(0, HISTORY);
  };
  const onPress = () => {
    pressedAt = win.performance.now();
  };
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget !== null) return;
    if (win.performance.now() - pressedAt < PRESS_MS) return;
    restoreSoon();
  };
  const onWindowFocus = () => restoreSoon();

  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("pointerdown", onPress, true);
  win.addEventListener("focus", onWindowFocus);

  return {
    restore,
    restoreSoon,
    dispose: () => {
      disposed = true;
      doc.removeEventListener("focusin", onFocusIn, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      doc.removeEventListener("pointerdown", onPress, true);
      win.removeEventListener("focus", onWindowFocus);
      recent = [];
    },
  };
}

let shared: FocusReturn | null = null;

/** The window's one focus return, installed by the app at start. */
export function installFocusReturn(): FocusReturn {
  shared ??= createFocusReturn();
  return shared;
}

/** Gives focus back after a view change, when the app installed it. */
export function restoreFocusSoon(): void {
  shared?.restoreSoon();
}

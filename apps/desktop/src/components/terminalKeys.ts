/**
 * Keys in a terminal. While its program runs, a key the terminal sends to the program is the
 * program's alone: no app shortcut sees it, and the browser does not act on it as well (Shift+Tab
 * moving focus, F5 reloading the window, PageUp scrolling the pane). Keys a terminal cannot send
 * (Ctrl+1, Ctrl+Comma, Command shortcuts on macOS) keep their meaning in the app. Ctrl+Tab and
 * Ctrl+Shift+Tab leave the terminal, the way out by keyboard: a terminal sends them as Tab and
 * Shift+Tab, so its program loses nothing. A terminal whose program is not running takes no keys
 * but its own scrolling, so Tab reaches the controls around it.
 */
type Key = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;

/**
 * Keys whose browser action happens outside the text: Tab and Shift+Tab move focus, PageUp and
 * PageDown scroll the page, F-keys reload, find, open developer tools or go full screen.
 */
export function actsOutsideText(event: Pick<KeyboardEvent, "type" | "key">): boolean {
  return (
    event.type === "keydown" &&
    (event.key === "Tab" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      FUNCTION_KEY.test(event.key))
  );
}

/**
 * Keys that type text, which xterm may send only later (capitals and AltGr characters on
 * keypress, IME and dead keys by composition): they are the program's from the start.
 */
export function typesText(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">,
): boolean {
  if (event.isComposing || event.key === "Dead" || event.key === "Process") return true;
  return [...event.key].length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey);
}

/** Ctrl+Tab leaves the terminal forward (1) and Ctrl+Shift+Tab back (-1); null for other keys. */
export function leavesTerminal(event: Key): 1 | -1 | null {
  if (event.key !== "Tab" || !event.ctrlKey || event.altKey || event.metaKey) return null;
  return event.shiftKey ? -1 : 1;
}

/** Shift+PageUp and Shift+PageDown scroll the terminal's own output, running or not. */
export function scrollsTerminal(event: Key): boolean {
  return (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "PageUp" || event.key === "PageDown")
  );
}

/**
 * Ctrl+Shift+C copies the selection on Windows and Linux, as in Windows Terminal and the Linux
 * terminals; macOS copies with Command+C, natively. A terminal cannot send Ctrl+Shift+C at all.
 */
export function copiesSelection(event: Key, mac = isMac()): boolean {
  return (
    !mac &&
    event.type === "keydown" &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "c"
  );
}

const CONTROLS =
  'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';

function tabbable(control: HTMLElement): boolean {
  if (control.tabIndex < 0) return false;
  if ((control as HTMLButtonElement).disabled === true) return false;
  if (control instanceof HTMLInputElement && control.type === "hidden") return false;
  if (control.closest("[inert]")) return false;
  // Not rendered: hidden, in a closed <details>, or in a collapsed pane.
  if (control.getClientRects().length === 0) return false;
  return getComputedStyle(control).visibility !== "hidden";
}

/**
 * Moves focus to the next (1) or previous (-1) control outside `from` in document order, wrapping
 * at the ends and staying inside an open dialog that holds `from`. False when no control took it.
 */
export function focusBeyond(from: Element, direction: 1 | -1): boolean {
  const scope = from.closest("dialog[open]") ?? from.ownerDocument;
  const controls = [...scope.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (control) => !from.contains(control) && tabbable(control),
  );
  const after = controls.filter(
    (control) => from.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const before = controls.filter(
    (control) => from.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  const order = direction === 1 ? [...after, ...before] : [...before.reverse(), ...after.reverse()];
  for (const control of order) {
    control.focus();
    if (from.ownerDocument.activeElement === control) return true;
  }
  return false;
}

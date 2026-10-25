import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Keycap, useReduced } from "./ui";

/*
 * Toasts (visual-language.md 4.17): X Money's translucent dark pill, top centre of the main pane,
 * 12px under the header, the one place CSS blur is allowed. One line and an optional action with
 * its keys ("Archived Tray icon states · Undo ⌘Z", Superhuman's undo instead of a confirm). Gone
 * after 4 s, held while the pointer is on it.
 */

export interface ToastMessage {
  /** A new id restarts the toast, so the same words can show twice in a row. */
  readonly id: number;
  readonly text: string;
  readonly action: string | null;
  /** What the action does. Without it, the action only closes the toast. */
  readonly onAction?: () => void;
  /** The action's shortcut, as keycaps (["⌘", "Z"]); Cmd Z also runs an Undo while it shows. */
  readonly keys?: readonly string[];
}

const TOAST_MS = 4000;

export function Toast({
  message,
  onDone,
}: {
  readonly message: ToastMessage | null;
  readonly onDone: () => void;
}) {
  const reduced = useReduced();
  const [held, setHeld] = useState(false);
  const latest = useRef({ message, onDone });
  latest.current = { message, onDone };

  useEffect(() => {
    if (!message || held) return;
    const timer = window.setTimeout(onDone, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDone, held]);

  // Cmd Z runs the toast's Undo while it shows.
  useEffect(() => {
    if (!message?.onAction || message.action !== "Undo") return;
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      latest.current.message?.onAction?.();
      latest.current.onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [message]);

  return (
    <div className="o-toast-slot" aria-live="polite">
      <AnimatePresence>
        {message ? (
          <motion.div
            key={message.id}
            className="o-toast o-t-ui"
            role="status"
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: reduced ? 0.12 : 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="o-toast-text">{message.text}</span>
            {message.action ? (
              <button
                type="button"
                className="o-toast-action"
                onClick={() => {
                  message.onAction?.();
                  onDone();
                }}
              >
                {message.action}
                {message.keys && message.keys.length > 0 ? (
                  <span className="o-keys">
                    {message.keys.map((key) => (
                      <Keycap key={key}>{key}</Keycap>
                    ))}
                  </span>
                ) : null}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

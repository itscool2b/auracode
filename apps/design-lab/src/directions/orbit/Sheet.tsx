import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Keycap, useReduced } from "./ui";

/*
 * The destructive confirm (visual-language.md 4.8): X Money's detached sheet over a scrim. A sentence
 * with grey verbs and bright objects, a tear line, the facts as key-value rows, one calm line about
 * what happens next, then Cancel and the one red pill. Risk is said in words; the red is the button
 * and nothing else. While it is up it owns the keyboard: Tab stays inside it, Esc cancels, and no key
 * reaches the window behind it (a permission card's 2 must not answer under a modal).
 */

export type SheetRequest =
  | {
      readonly kind: "revert";
      /** "turn 1" */
      readonly title: string;
      readonly project: string;
      readonly files: number;
      readonly checkpoint: string;
    }
  | {
      readonly kind: "delete";
      /** The chat's title. */
      readonly title: string;
      readonly project: string;
      /** The chat, so its row can leave the sidebar (and come back on Undo). */
      readonly chatId: string | null;
    };

export function Sheet({
  request,
  onCancel,
  onConfirm,
}: {
  readonly request: SheetRequest;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const reduced = useReduced();
  const sheetRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(onCancel);
  latest.current = onCancel;
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      // Every key is the sheet's: nothing behind the scrim hears it.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...(sheetRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      if (buttons.length === 0) return;
      event.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[at === -1 ? 0 : next]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const revert = request.kind === "revert";
  return (
    <motion.div
      className="o-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.2 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <motion.section
        ref={sheetRef}
        className="o-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-label={revert ? `Revert ${request.title}` : `Delete ${request.title}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: reduced ? 0.12 : 0.4, ease: [0.32, 0.72, 0, 1] }}
      >
        <h2 className="o-sheet-title o-t-title">
          <span className="o-c3">{revert ? "Revert " : "Delete "}</span>
          <span className="o-c1">{request.title}</span>
          <span className="o-c3"> in </span>
          <span className="o-c1">{request.project}</span>
        </h2>
        <div className="o-tear o-sheet-tear" aria-hidden="true" />
        <dl className="o-sheet-rows o-t-ui">
          {request.kind === "revert" ? (
            <>
              <div className="o-perm-row">
                <dt className="o-c3">Files</dt>
                <dd className="o-c1 o-num">
                  {request.files} {request.files === 1 ? "file" : "files"}
                </dd>
              </div>
              <div className="o-perm-row">
                <dt className="o-c3">Checkpoint</dt>
                <dd className="o-t-mono o-c1">{request.checkpoint}</dd>
              </div>
              <div className="o-perm-row">
                <dt className="o-c3">Created</dt>
                <dd className="o-c1">Before this turn</dd>
              </div>
            </>
          ) : (
            <>
              <div className="o-perm-row">
                <dt className="o-c3">Project</dt>
                <dd className="o-c1">{request.project}</dd>
              </div>
              <div className="o-perm-row">
                <dt className="o-c3">Files</dt>
                <dd className="o-c1">Stay as they are</dd>
              </div>
            </>
          )}
        </dl>
        <p className="o-sheet-calm o-t-ui o-c2">
          {revert
            ? "Your changes after this point move to a new checkpoint."
            : "The chat and its checkpoints go away. The agent's session stays on disk."}
        </p>
        <div className="o-sheet-actions">
          <button ref={cancelRef} type="button" className="o-btn o-btn-soft" onClick={onCancel}>
            Cancel
            <Keycap>esc</Keycap>
          </button>
          <button type="button" className="o-btn o-btn-red" onClick={onConfirm}>
            {revert ? "Revert" : "Delete"}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

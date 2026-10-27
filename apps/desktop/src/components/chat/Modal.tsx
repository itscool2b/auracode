import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/** Native modal focus containment and Escape handling, shared by project and chat actions. */
export function Modal({
  title,
  onClose,
  children,
  className = "",
  closeDisabled = false,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly closeDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  // The dialog is Graphite (`.chat-modal`, shell.css) and portals outside the app root.
  return createPortal(
    <dialog
      ref={dialog}
      className={`chat-modal ${className}`}
      data-theme="dark"
      aria-labelledby={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
    >
      <header>
        <h2 id={label}>{title}</h2>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-28"
          aria-label="Close"
          onClick={onClose}
          disabled={closeDisabled}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}

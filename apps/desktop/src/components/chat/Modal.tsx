import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/** Native modal focus containment and Escape handling, shared by project and chat actions. */
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className={`orbit-theme chat-modal ${className}`}
      data-theme="dark"
      aria-labelledby={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={label}>{title}</h2>
        <button type="button" className="chat-icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}

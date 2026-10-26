import { type ReactNode, useEffect, useRef, useState } from "react";

/** A native disclosure with outside-click and Escape dismissal, retaining keyboard focus. */
export function Popover({
  label,
  trigger,
  children,
  className = "",
}: {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current)
        root.current.open = false;
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !root.current) return;
      event.preventDefault();
      root.current.open = false;
      root.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);
  return (
    <details
      ref={root}
      className={`chat-popover ${className}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={label} title={label}>
        {trigger}
      </summary>
      <section className="chat-popover-panel" aria-label={label}>
        {children}
      </section>
    </details>
  );
}

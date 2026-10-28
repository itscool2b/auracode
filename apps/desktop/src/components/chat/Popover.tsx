import { type ReactNode, useEffect, useRef, useState } from "react";
import { focusPickerChoice } from "./PickerChoices";

/**
 * A native disclosure with outside-click and Escape dismissal, retaining keyboard focus. `tip`
 * swaps the platform tooltip for Graphite's (4.6): a small surface-3 label that fades in after
 * 500ms of hover. `onOpenChange` lets a parent follow the open state.
 */
export function Popover({
  label,
  trigger,
  children,
  className = "",
  shortcut,
  triggerLabel,
  tip,
  onOpenChange,
}: {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly shortcut?: string;
  readonly triggerLabel?: string;
  readonly tip?: string;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!shortcut) return;
    const toggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key !== shortcut)
        return;
      if (document.querySelector("dialog[open]")) return;
      const element = root.current;
      if (!element || element.closest("[hidden]")) return;
      event.preventDefault();
      element.open = !element.open;
      if (element.open) focusPickerChoice(element);
      else element.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [shortcut]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current)
        root.current.open = false;
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !root.current) return;
      if (root.current.closest("[hidden]")) return;
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
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
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary
        aria-label={triggerLabel ?? label}
        title={tip ? undefined : label}
        data-tip={tip}
        aria-keyshortcuts={shortcut ? `Control+${shortcut} Meta+${shortcut}` : undefined}
      >
        {trigger}
      </summary>
      <section className="chat-popover-panel" aria-label={label}>
        {children}
      </section>
    </details>
  );
}

/** Closes the popover (or menu) that holds `element`, as choosing one of its items should. */
export function closePopover(element: Element | null): void {
  const details = element?.closest("details");
  if (details) details.open = false;
}

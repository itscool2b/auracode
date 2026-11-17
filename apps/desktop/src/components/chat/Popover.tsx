import { type ReactNode, useEffect, useRef, useState } from "react";
import { focusPickerChoice } from "./PickerChoices";

/**
 * A native disclosure with outside-click and Escape dismissal, retaining keyboard focus. `tip`
 * swaps the platform tooltip for Graphite's (4.6): a small surface-3 label that fades in after
 * 500ms of hover. `onOpenChange` lets a parent follow the open state.
 *
 * The panel rises in as it opens and settles out as it closes (motion.css); focus moves at once,
 * and with reduced motion it simply closes.
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
    const details = root.current;
    if (!details) return;
    // The panel settles out instead of vanishing; a click while it does keeps it open.
    const click = (event: MouseEvent) => {
      const summary = details.querySelector(":scope > summary");
      if (!details.open || !(event.target instanceof Node) || !summary?.contains(event.target))
        return;
      event.preventDefault();
      if (closing(details)) stayOpen(details);
      else closeDetails(details);
    };
    details.addEventListener("click", click);
    return () => details.removeEventListener("click", click);
  }, []);
  useEffect(() => {
    if (!shortcut) return;
    const toggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key !== shortcut)
        return;
      if (document.querySelector("dialog[open]")) return;
      const element = root.current;
      if (!element || element.closest("[hidden]")) return;
      event.preventDefault();
      if (element.open && !closing(element)) {
        closeDetails(element);
        element.querySelector("summary")?.focus();
      } else {
        stayOpen(element);
        element.open = true;
        focusPickerChoice(element);
      }
    };
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [shortcut]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current)
        closeDetails(root.current);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !root.current) return;
      if (root.current.closest("[hidden]")) return;
      // An open dropdown inside the popover takes this Escape for its own list.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="combobox"][aria-expanded="true"]')
      )
        return;
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      event.preventDefault();
      closeDetails(root.current);
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

function closing(details: HTMLDetailsElement): boolean {
  return details.hasAttribute("data-closing");
}

/** A close on its way is called off. */
function stayOpen(details: HTMLDetailsElement): void {
  details.removeAttribute("data-closing");
}

/**
 * Closes `details` once its panel's exit animation ends, or at once where nothing animates
 * (reduced motion, or no animation support).
 */
function closeDetails(details: HTMLDetailsElement): void {
  if (!details.open || closing(details)) return;
  const panel = details.querySelector<HTMLElement>(":scope > .chat-popover-panel");
  details.setAttribute("data-closing", "");
  const animations =
    panel && typeof panel.getAnimations === "function"
      ? panel.getAnimations().filter((animation) => animation.playState !== "finished")
      : [];
  const finish = () => {
    if (!closing(details)) return;
    details.removeAttribute("data-closing");
    details.open = false;
  };
  if (!animations.length) {
    finish();
    return;
  }
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
}

/** Closes the enclosing popover, optionally returning focus after its selected item is hidden. */
export function closePopover(element: Element | null, restoreFocus = false): void {
  const details = element?.closest("details");
  if (details) {
    closeDetails(details);
    if (restoreFocus) details.querySelector("summary")?.focus();
  }
}

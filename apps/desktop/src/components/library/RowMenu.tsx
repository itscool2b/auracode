import { Ellipsis } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * A row's kebab (Vercel's project menu): plain items; arrows move, Escape closes and returns.
 *
 * The menu is fixed beside its trigger, so it closes once the trigger moves under it (a scroll of
 * the page, a resized window). A scroll event alone does not close it: one that ends a scroll made
 * before the menu opened (bringing the row into view, then clicking) arrives a frame later, and
 * the trigger has not moved since the menu was placed.
 */
export function RowMenu({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly MenuItem[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const placedAt = useRef<{ top: number; right: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    placedAt.current = { top: box.top, right: box.right };
    const height = menu.current?.offsetHeight ?? 0;
    const below = box.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({
      top: below ? box.bottom + 4 : Math.max(8, box.top - 4 - height),
      right: Math.max(8, window.innerWidth - box.right),
    });
    // The menu is not placed until the next render: focusing it must not scroll anything.
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const dismiss = () => close(false);
    const moved = () => {
      const box = trigger.current?.getBoundingClientRect();
      const placed = placedAt.current;
      if (
        !box ||
        !placed ||
        Math.abs(box.top - placed.top) > 1 ||
        Math.abs(box.right - placed.right) > 1
      )
        close(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", moved, true);
    };
  });
  const move = (event: React.KeyboardEvent) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => entries[(index + entries.length) % entries.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Escape" || event.key === "Tab") close();
    else return;
    if (event.key !== "Tab") event.preventDefault();
    event.stopPropagation();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="g-button g-button-ghost g-button-icon g-button-28"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              className="g-root g-menu plugins-menu"
              style={place}
              onKeyDown={move}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="g-menu-item"
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            trigger.current?.closest("main") ?? document.body,
          )
        : null}
    </>
  );
}

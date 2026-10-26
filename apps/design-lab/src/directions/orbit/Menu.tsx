import { Check, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { popover, useOutsideClose, useReduced } from "./ui";

/*
 * Menus (visual-language.md 4.20): X Money's overflow menu and Linear's rows that teach their
 * shortcuts. 30px rows: a 14px icon, the label from the left, the shortcut right-aligned in mono;
 * rules between groups and the one destructive row last, in red. Rows the lab cannot do yet stay
 * visible but disabled, with a tooltip that says so, so the menu shows what the app will hold. A
 * menu opens away from what would cover it: down from the header, up from a turn's receipt, which
 * sits right above the composer.
 */

export interface MenuItem {
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly shortcut?: string;
  readonly onSelect?: () => void;
  readonly destructive?: boolean;
  /** A choice that is on: a check at the right instead of a shortcut. */
  readonly checked?: boolean;
  /** Not built in the lab yet: shown disabled, with "Not in this lab yet". */
  readonly soon?: boolean;
}

/** A menu's groups, split by rules; the destructive row goes in the last group. */
export type MenuGroups = readonly (readonly MenuItem[])[];

export function Menu({
  groups,
  label,
  align = "end",
  side = "bottom",
  onClose,
  anchor,
}: {
  readonly groups: MenuGroups;
  readonly label: string;
  /** Which edge of the anchor the menu lines up with. */
  readonly align?: "start" | "end";
  /** Which way it opens from the anchor. */
  readonly side?: "top" | "bottom";
  readonly onClose: () => void;
  readonly anchor: { readonly current: HTMLElement | null };
}) {
  const reduced = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(-1);
  useOutsideClose(ref, onClose, anchor);
  const enabled = groups.flat().filter((item) => !item.soon);
  const latest = useRef({ enabled, focus, onClose });
  latest.current = { enabled, focus, onClose };
  useEffect(() => {
    // Capture phase: the menu is the top layer, so its keys never reach the window's own.
    const onKey = (event: KeyboardEvent): void => {
      const { enabled: rows, focus: at, onClose: close } = latest.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.current?.focus({ preventScroll: true });
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setFocus((current) => (current + step + rows.length) % Math.max(1, rows.length));
      } else if (event.key === "Enter" && at >= 0) {
        event.preventDefault();
        event.stopPropagation();
        rows[at]?.onSelect?.();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anchor]);
  let index = -1;
  return (
    <motion.div
      ref={ref}
      className="o-menu o-pop-menu"
      role="menu"
      aria-label={label}
      data-orbit-menu=""
      data-align={align}
      data-side={side}
      {...popover(reduced)}
    >
      {groups.map((group, groupIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: groups are positional.
        <div key={groupIndex} className="o-menu-group">
          {groupIndex > 0 ? <div className="o-menu-rule" /> : null}
          {group.map((item) => {
            if (!item.soon) index += 1;
            const at = index;
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                {...(item.checked === undefined
                  ? { role: "menuitem" }
                  : { role: "menuitemradio", "aria-checked": item.checked })}
                className="o-menu-row o-t-ui"
                data-destructive={item.destructive ? "" : undefined}
                data-focus={!item.soon && at === focus ? "" : undefined}
                aria-disabled={item.soon ? true : undefined}
                title={item.soon ? "Not in this lab yet" : undefined}
                onClick={() => {
                  if (item.soon) return;
                  item.onSelect?.();
                  onClose();
                }}
              >
                <span className="o-menu-icon" aria-hidden="true">
                  {Icon ? <Icon size={14} strokeWidth={1.5} /> : null}
                </span>
                <span className="o-menu-label">{item.label}</span>
                {item.checked ? (
                  <Check className="o-menu-key" size={14} strokeWidth={1.75} aria-hidden="true" />
                ) : item.shortcut ? (
                  <span className="o-menu-key o-t-mono o-mono-11">{item.shortcut}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </motion.div>
  );
}

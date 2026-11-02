import { Check } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

/**
 * Focuses the chosen row under `root`, else its first enabled one. A menu with a part marked
 * `data-picker-initial` (the model list) opens there when it has an enabled row.
 */
export function focusPickerChoice(root: Element | undefined) {
  const pressed = 'button[aria-pressed="true"]:not(:disabled)';
  const initial = root?.querySelector("[data-picker-initial]");
  const target =
    initial?.querySelector<HTMLButtonElement>(pressed) ??
    initial?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
    root?.querySelector<HTMLButtonElement>(pressed) ??
    root?.querySelector<HTMLButtonElement>("button:not(:disabled)");
  target?.focus();
}

/** Move within a column without committing a setting until Enter or a click. */
export function movePickerFocus(event: KeyboardEvent<HTMLElement>) {
  const root = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const rows = [...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const index = rows.indexOf(target);
  if (index < 0 || !rows.length) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
  rows[next]?.focus();
}

export type PickerChoice = {
  value: string;
  name: string;
  description?: string | null;
  group?: string | null;
};

export function PickerChoices({
  label,
  choices,
  value,
  busy = null,
  enabled,
  onChoose,
  effort = false,
  children,
}: {
  readonly label: string;
  readonly choices: readonly PickerChoice[];
  readonly value: string;
  /** The value a change on its way asked for: it shows chosen, marked busy until the answer. */
  readonly busy?: string | null;
  readonly enabled: boolean;
  readonly onChoose: (value: string) => void;
  readonly effort?: boolean;
  readonly children?: ReactNode;
}) {
  if (effort)
    // The thinking level is one segmented row: the levels side by side, the chosen one raised,
    // digits choosing by position.
    return (
      <fieldset
        className="picker-choices g-segmented g-segmented-quiet"
        data-layout="segments"
        aria-label={label}
        onKeyDown={movePickerFocus}
      >
        {children}
        {choices.map((choice, index) => (
          <button
            key={choice.value}
            type="button"
            className="g-segment"
            data-picker-value={choice.value}
            aria-pressed={value === choice.value}
            aria-busy={busy === choice.value || undefined}
            disabled={!enabled}
            title={[choice.name, choice.description, index < 9 ? `Key ${index + 1}` : null]
              .filter(Boolean)
              .join(" · ")}
            onClick={() => onChoose(choice.value)}
          >
            <span>{choice.name}</span>
          </button>
        ))}
      </fieldset>
    );
  return (
    <fieldset className="picker-choices" aria-label={label} onKeyDown={movePickerFocus}>
      {children}
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          data-picker-value={choice.value}
          aria-pressed={value === choice.value}
          aria-busy={busy === choice.value || undefined}
          disabled={!enabled}
          title={choice.description ?? undefined}
          onClick={() => onChoose(choice.value)}
        >
          <span className="picker-choice-copy">
            <strong>{choice.name}</strong>
            {choice.description || choice.group ? (
              <small>{choice.description ?? choice.group}</small>
            ) : null}
          </span>
          {value === choice.value ? <Check size={14} aria-label="Selected" /> : null}
        </button>
      ))}
    </fieldset>
  );
}

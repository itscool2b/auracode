import { Check } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

export function focusPickerChoice(root: Element | undefined) {
  const chosen = root?.querySelector<HTMLButtonElement>(
    'button[aria-pressed="true"]:not(:disabled)',
  );
  (chosen ?? root?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
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
  enabled,
  onChoose,
  effort = false,
  children,
}: {
  readonly label: string;
  readonly choices: readonly PickerChoice[];
  readonly value: string;
  readonly enabled: boolean;
  readonly onChoose: (value: string) => void;
  readonly effort?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <fieldset className="picker-choices" aria-label={label} onKeyDown={movePickerFocus}>
      {children}
      {choices.map((choice, index) => (
        <button
          key={choice.value}
          type="button"
          data-picker-value={choice.value}
          aria-pressed={value === choice.value}
          disabled={!enabled}
          title={choice.description ?? undefined}
          onClick={() => onChoose(choice.value)}
        >
          {effort ? (
            <span className="picker-effort-ticks" aria-hidden="true">
              {choices.map((tick, level) => (
                <i key={tick.value} data-filled={level <= index} />
              ))}
            </span>
          ) : null}
          <span className="picker-choice-copy">
            <strong>{choice.name}</strong>
            {choice.description || choice.group ? (
              <small>{choice.description ?? choice.group}</small>
            ) : null}
          </span>
          {value === choice.value ? (
            <Check size={13} aria-label="Selected" />
          ) : effort && index < 9 ? (
            <kbd>{index + 1}</kbd>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}

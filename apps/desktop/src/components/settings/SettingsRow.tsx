import type { ReactNode } from "react";

/** A settings row: the label, an optional one-line description, and at most one control. */
export function Row({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div>
          <strong>{title}</strong>
          {detail ? <p>{detail}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/** A row's switch (4.3): a native checkbox, named by its row. */
export function Switch({
  label,
  checked,
  disabled,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="g-switch settings-control"
      aria-label={label}
      aria-checked={checked}
      data-testid={testId}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

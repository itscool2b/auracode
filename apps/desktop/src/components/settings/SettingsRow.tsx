import type { ReactNode } from "react";

/**
 * A settings row: the label, an optional one-line description, and at most one control. Settings'
 * search finds it by `setting`, its title unless the title varies (settingsIndex.ts). `mark` leads
 * the row with a tile holding the glyph of what the row is about; `badge` sits beside the label.
 */
export function Row({
  title,
  detail,
  children,
  setting = title,
  mark,
  badge,
}: {
  readonly title: string;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
  readonly setting?: string;
  readonly mark?: ReactNode;
  readonly badge?: ReactNode;
}) {
  return (
    <div className="settings-row" data-setting={setting}>
      <div className="settings-row-text">
        {mark ? (
          <span className="settings-tile" aria-hidden="true">
            {mark}
          </span>
        ) : null}
        <div>
          {badge ? (
            <span className="settings-row-title">
              <strong>{title}</strong>
              {badge}
            </span>
          ) : (
            <strong>{title}</strong>
          )}
          {detail ? <p>{detail}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/** How something stands, as a dot and a few words: green when it works, amber when it waits. */
export function State({
  tone,
  children,
}: {
  readonly tone: "green" | "amber" | "red" | "off";
  readonly children: ReactNode;
}) {
  return (
    <span className="settings-state" data-tone={tone}>
      <span className="g-status-dot" data-tone={tone} aria-hidden="true" />
      {children}
    </span>
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

import { Fragment, useId } from "react";
import type {
  Autonomy,
  ConfigOption,
  ConfigValue,
  SessionLists,
  SessionStatus,
} from "../../bindings";
import { AUTONOMIES, autonomyLabel, orderedOptions, pendingLabel } from "../../lib/chat/present";

/**
 * Autonomy (always enabled: it applies when the agent starts), with its note, the agent mode in
 * effect, and the missing safety net while Full auto is chosen; then one select or checkbox per
 * option the agent offers, enabled while the agent is ready or working, pending values marked.
 */
export function Pickers({
  lists,
  autonomy,
  status,
  error,
  onSetAutonomy,
  onSetOption,
}: {
  readonly lists: SessionLists | null;
  /** The chat's autonomy until the lists arrive. */
  readonly autonomy: Autonomy;
  readonly status: SessionStatus;
  readonly error: string | null;
  readonly onSetAutonomy: (autonomy: Autonomy) => void;
  readonly onSetOption: (optionId: string, value: ConfigValue) => void;
}) {
  const autonomyId = useId();
  const chosen = lists?.autonomy.requested ?? autonomy;
  const optionsEnabled = status === "ready" || status === "running";
  const options = orderedOptions(lists?.options ?? []);
  return (
    <div className="chat-pickers">
      <div className="ui-field">
        <label htmlFor={autonomyId}>Autonomy</label>
        <select
          id={autonomyId}
          className="ui-select"
          value={chosen}
          onChange={(event) => onSetAutonomy(event.currentTarget.value as Autonomy)}
        >
          {AUTONOMIES.map((value) => (
            <option key={value} value={value}>
              {autonomyLabel(value)}
            </option>
          ))}
        </select>
      </div>
      {options.map((option) => (
        <OptionPicker
          key={option.id}
          option={option}
          enabled={optionsEnabled}
          onSet={onSetOption}
        />
      ))}
      <div className="chat-picker-note">
        {chosen === "full_auto" ? <div>Full auto: no checkpoints until M2.</div> : null}
        {lists?.autonomy.note ? <div>{lists.autonomy.note}</div> : null}
        {lists?.autonomy.native_mode ? <div>Agent mode: {lists.autonomy.native_mode}</div> : null}
        {error !== null ? (
          <div role="alert" className="ui-error">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OptionPicker({
  option,
  enabled,
  onSet,
}: {
  readonly option: ConfigOption;
  readonly enabled: boolean;
  readonly onSet: (optionId: string, value: ConfigValue) => void;
}) {
  const id = useId();
  const pending = option.pending === null ? null : pendingLabel(option, option.pending);
  const label = (
    <>
      {option.name}
      {pending !== null ? <span className="ui-muted"> (pending: {pending})</span> : null}
    </>
  );
  if (option.kind.type === "toggle") {
    return (
      <div className="ui-field">
        <label htmlFor={id} title={option.description ?? undefined}>
          <input
            id={id}
            type="checkbox"
            checked={option.kind.current}
            disabled={!enabled}
            onChange={(event) =>
              onSet(option.id, { type: "toggle", value: event.currentTarget.checked })
            }
          />{" "}
          {label}
        </label>
      </div>
    );
  }
  const { choices, current } = option.kind;
  const groups = [...new Set(choices.map((choice) => choice.group))];
  const render = (group: string | null) =>
    choices
      .filter((choice) => choice.group === group)
      .map((choice) => (
        <option key={choice.value} value={choice.value} title={choice.description ?? undefined}>
          {choice.name}
        </option>
      ));
  return (
    <div className="ui-field">
      <label htmlFor={id} title={option.description ?? undefined}>
        {label}
      </label>
      <select
        id={id}
        className="ui-select"
        value={current}
        disabled={!enabled}
        onChange={(event) => onSet(option.id, { type: "choice", value: event.currentTarget.value })}
      >
        {groups.length <= 1
          ? render(groups[0] ?? null)
          : groups.map((group) =>
              group === null ? (
                <Fragment key="">{render(null)}</Fragment>
              ) : (
                <optgroup key={group} label={group}>
                  {render(group)}
                </optgroup>
              ),
            )}
      </select>
    </div>
  );
}

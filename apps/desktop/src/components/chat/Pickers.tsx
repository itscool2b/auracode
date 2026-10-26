import { OrbitMark } from "@auracode/ui/orbit";
import { ChevronDown, Signal } from "lucide-react";
import { Fragment, useId } from "react";
import type {
  AgentEntry,
  Autonomy,
  ConfigOption,
  ConfigValue,
  SessionLists,
  SessionStatus,
} from "../../bindings";
import { AUTONOMIES, autonomyLabel, orderedOptions, pendingLabel } from "../../lib/chat/present";
import { Popover } from "./Popover";

/**
 * Autonomy (always enabled: it applies when the agent starts), with its note, the agent mode in
 * effect, and the missing safety net while Full auto is chosen; then one select or checkbox per
 * option the agent offers, enabled while the agent is ready or working, pending values marked. A
 * change on its way (up to 35 s) shows the value asked for, marked "saving", instead of snapping
 * back to the old one.
 */
export function Pickers({
  lists,
  autonomy,
  status,
  error,
  optionsSaving = new Map(),
  autonomySaving = null,
  onSetAutonomy,
  onSetOption,
  agent = null,
}: {
  readonly lists: SessionLists | null;
  /** The chat's autonomy until the lists arrive. */
  readonly autonomy: Autonomy;
  readonly status: SessionStatus;
  readonly error: string | null;
  /** Option changes on their way, by option id. */
  readonly optionsSaving?: ReadonlyMap<string, ConfigValue>;
  readonly autonomySaving?: Autonomy | null;
  readonly onSetAutonomy: (autonomy: Autonomy) => void;
  readonly onSetOption: (optionId: string, value: ConfigValue) => void;
  readonly agent?: AgentEntry | null;
}) {
  const autonomyId = useId();
  const chosen = autonomySaving ?? lists?.autonomy.requested ?? autonomy;
  const optionsEnabled = status === "ready" || status === "running";
  const options = orderedOptions(lists?.options ?? []);
  const choiceLabel = (option: ConfigOption) =>
    option.kind.type === "select"
      ? (option.kind.choices.find((choice) => choice.value === option.kind.current)?.name ?? null)
      : null;
  const model = options.find((option) => option.category === "model");
  const effort = options.find((option) => option.category === "effort");
  return (
    <div className="chat-pickers">
      <Popover
        label="Agent and model"
        className="chat-model-popover"
        trigger={
          <>
            <OrbitMark agent={agent?.id ?? "generic"} size={16} />
            <strong>{agent?.name ?? "Agent"}</strong>
            {model ? <span className="chat-pill-model">{choiceLabel(model)}</span> : null}
            {effort ? <span className="chat-pill-effort">{choiceLabel(effort)}</span> : null}
            <ChevronDown size={12} />
          </>
        }
      >
        <div className="chat-model-columns">
          <section>
            <h3>Agent</h3>
            <span className="chat-current-agent">
              <OrbitMark agent={agent?.id ?? "generic"} size={20} />
              {agent?.name ?? "Agent"}
            </span>
            <p>{agent?.description ?? "The agent attached to this chat."}</p>
          </section>
          <section>
            <h3>Model and options</h3>
            {options.length === 0 ? (
              <p>
                {optionsEnabled
                  ? "This agent has no configurable options."
                  : "Start the session to load its models and options."}
              </p>
            ) : null}
            {options.map((option) => (
              <OptionPicker
                key={option.id}
                option={option}
                saving={optionsSaving.get(option.id) ?? null}
                enabled={optionsEnabled}
                onSet={onSetOption}
              />
            ))}
          </section>
        </div>
      </Popover>
      <Popover
        label="Autonomy"
        className="chat-autonomy-popover"
        trigger={
          <>
            <Signal size={15} />
            <span>{autonomyLabel(chosen)}</span>
            <ChevronDown size={12} />
          </>
        }
      >
        <div className="ui-field">
          <label htmlFor={autonomyId}>
            Autonomy
            {autonomySaving !== null ? <span className="ui-muted"> (saving…)</span> : null}
          </label>
          <select
            id={autonomyId}
            className="ui-select"
            data-testid="picker-autonomy"
            data-test-requested={lists?.autonomy.requested ?? ""}
            data-test-native-mode={lists?.autonomy.native_mode ?? ""}
            data-test-saving={String(autonomySaving !== null)}
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
        <div className="chat-picker-note">
          {chosen === "full_auto" ? <div>Full auto: changes are not checkpointed yet.</div> : null}
          {lists?.autonomy.note ? <div>{lists.autonomy.note}</div> : null}
          {lists?.autonomy.native_mode ? <div>Agent mode: {lists.autonomy.native_mode}</div> : null}
          {error !== null ? (
            <div role="alert" className="ui-error" data-testid="picker-error">
              {error}
            </div>
          ) : null}
        </div>
      </Popover>
      {error !== null ? (
        <span
          className="chat-picker-error-dot"
          role="img"
          aria-label="Session settings error. Open Autonomy for details."
        />
      ) : null}
    </div>
  );
}

function OptionPicker({
  option,
  saving,
  enabled,
  onSet,
}: {
  readonly option: ConfigOption;
  /** The value a change on its way asked for. */
  readonly saving: ConfigValue | null;
  readonly enabled: boolean;
  readonly onSet: (optionId: string, value: ConfigValue) => void;
}) {
  const id = useId();
  const pending = option.pending === null ? null : pendingLabel(option, option.pending);
  const label = (
    <>
      {option.name}
      {saving !== null ? (
        <span className="ui-muted"> (saving…)</span>
      ) : pending !== null ? (
        <span className="ui-muted"> (pending: {pending})</span>
      ) : null}
    </>
  );
  if (option.kind.type === "toggle") {
    return (
      <div className="ui-field">
        <label htmlFor={id} title={option.description ?? undefined}>
          <input
            id={id}
            type="checkbox"
            data-testid="picker-option"
            data-test-option-id={option.id}
            data-test-saving={String(saving !== null)}
            checked={saving?.type === "toggle" ? saving.value : option.kind.current}
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
        data-testid="picker-option"
        data-test-option-id={option.id}
        data-test-saving={String(saving !== null)}
        value={saving?.type === "choice" ? saving.value : current}
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

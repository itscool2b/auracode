import { AgentMark } from "@auracode/ui/graphite";
import { ChevronDown } from "lucide-react";
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
import { focusPickerChoice, movePickerFocus, PickerChoices } from "./PickerChoices";
import { Popover } from "./Popover";

/**
 * The autonomy level as three square ticks, 4, 6 and 8px tall (6.11): Ask fills one, Auto-edit
 * two, Full auto three. Decorative; the label beside it names the level.
 */
function AutonomyGlyph({ autonomy }: { readonly autonomy: Autonomy }) {
  const level = autonomy === "full_auto" ? 3 : autonomy === "auto_edit" ? 2 : 1;
  return (
    <svg
      className="chat-autonomy-glyph"
      width="10"
      height="8"
      viewBox="0 0 10 8"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {[4, 6, 8].map((height, index) => (
        <rect
          key={height}
          x={index * 4}
          y={8 - height}
          width="2"
          height={height}
          data-on={index < level}
        />
      ))}
    </svg>
  );
}

const AGENT_KEYS: Readonly<Record<string, string>> = {
  claude: "c",
  codex: "x",
  "grok-build": "g",
  cursor: "u",
  pi: "p",
  "oh-my-pi": "m",
  opencode: "o",
  hermes: "h",
  antigravity: "a",
};

/**
 * Autonomy (always enabled: it applies when the agent starts), with its note, the agent mode in
 * effect, and the checkpoint behavior while Full auto is chosen; then one select or checkbox per
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
  agents,
  onChooseAgent,
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
  readonly agents?: readonly AgentEntry[] | null;
  readonly onChooseAgent?: (id: string) => void;
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
        triggerLabel={[
          agent?.name ?? "Agent",
          model && choiceLabel(model),
          effort && choiceLabel(effort),
          "Agent and model",
        ]
          .filter(Boolean)
          .join(" ")}
        shortcut="."
        className="chat-model-popover"
        trigger={
          // A quiet text control (Aside): the agent, its model and effort, then a chevron. The
          // agent's mark lives in the header and the picker rows; here its code would be visible
          // text missing from the control's name.
          <>
            <strong>{agent?.name ?? "Agent"}</strong>{" "}
            {model ? <span className="chat-pill-model">{choiceLabel(model)}</span> : null}{" "}
            {effort ? <span className="chat-pill-effort">{choiceLabel(effort)}</span> : null}
            <ChevronDown size={12} />
          </>
        }
      >
        <fieldset
          className="chat-model-columns"
          aria-label="Agent, model and effort"
          data-columns="three"
          onKeyDown={(event) => {
            if (
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.target instanceof HTMLSelectElement
            )
              return;
            const columns = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(":scope > section"),
            ];
            const column = (event.target as HTMLElement).closest<HTMLElement>(
              ".chat-model-columns > section",
            );
            const index = column ? columns.indexOf(column) : 0;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const next =
                columns[
                  (index + (event.key === "ArrowRight" ? 1 : -1) + columns.length) % columns.length
                ];
              focusPickerChoice(next);
            } else if (
              /^[1-9]$/.test(event.key) &&
              effort?.kind.type === "select" &&
              optionsEnabled
            ) {
              const choice = effort.kind.choices[Number(event.key) - 1];
              if (choice) {
                event.preventDefault();
                onSetOption(effort.id, { type: "choice", value: choice.value });
              }
            } else if (/^[a-z]$/i.test(event.key)) {
              const row = event.currentTarget.querySelector<HTMLButtonElement>(
                `button[data-agent-key="${event.key.toLowerCase()}"]:not(:disabled)`,
              );
              if (row) {
                event.preventDefault();
                row.focus();
              }
            }
          }}
        >
          <section>
            <h3>Agent</h3>
            {agents?.length && onChooseAgent ? (
              <fieldset
                className="chat-agent-choices"
                aria-label="Agents"
                onKeyDown={movePickerFocus}
              >
                {agents.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={entry.id === agent?.id}
                    data-agent-key={AGENT_KEYS[entry.id]}
                    disabled={entry.availability.state !== "ready"}
                    onClick={(event) => {
                      if (entry.id !== agent?.id) {
                        const details = event.currentTarget.closest("details");
                        if (details) details.open = false;
                        onChooseAgent(entry.id);
                      }
                    }}
                  >
                    <AgentMark agent={entry.id} size={16} />
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.availability.state === "ready"
                          ? (entry.availability.version ?? "Installed")
                          : entry.availability.state.replaceAll("_", " ")}
                      </small>
                    </span>
                    {AGENT_KEYS[entry.id] ? <kbd>{AGENT_KEYS[entry.id]?.toUpperCase()}</kbd> : null}
                  </button>
                ))}
              </fieldset>
            ) : (
              <span className="chat-current-agent">
                <AgentMark agent={agent?.id ?? "generic"} size={16} />
                {agent?.name ?? "Agent"}
              </span>
            )}
            <p>Switching agents opens a visible context preview.</p>
          </section>
          <section>
            <h3>Model</h3>
            {!model ? (
              <p>
                {optionsEnabled
                  ? "This agent does not offer a model selector."
                  : "Start the session to load its models and options."}
              </p>
            ) : null}
            {options
              .filter((option) => option.category === "model")
              .map((option) => (
                <OptionPicker
                  key={option.id}
                  option={option}
                  saving={optionsSaving.get(option.id) ?? null}
                  enabled={optionsEnabled}
                  onSet={onSetOption}
                />
              ))}
          </section>
          <section>
            <h3>Effort</h3>
            {!effort ? (
              <p>{optionsEnabled ? "No effort setting" : "Available after the session starts."}</p>
            ) : null}
            {options
              .filter((option) => option.category === "effort")
              .map((option) => (
                <OptionPicker
                  key={option.id}
                  option={option}
                  saving={optionsSaving.get(option.id) ?? null}
                  enabled={optionsEnabled}
                  onSet={onSetOption}
                />
              ))}
            {options.some(
              (option) => option.category !== "model" && option.category !== "effort",
            ) ? (
              <details className="chat-other-options">
                <summary>More options</summary>
                {options
                  .filter((option) => option.category !== "model" && option.category !== "effort")
                  .map((option) => (
                    <OptionPicker
                      key={option.id}
                      option={option}
                      saving={optionsSaving.get(option.id) ?? null}
                      enabled={optionsEnabled}
                      onSet={onSetOption}
                    />
                  ))}
              </details>
            ) : null}
          </section>
        </fieldset>
        <footer className="picker-key-legend">
          ↑ ↓ move <span>← → column</span> <span>enter choose</span> <span>esc close</span>
        </footer>
      </Popover>
      <Popover
        label="Autonomy"
        triggerLabel={`${autonomyLabel(chosen)}. Autonomy`}
        className="chat-autonomy-popover"
        trigger={
          <>
            <AutonomyGlyph autonomy={chosen} />
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
            className="g-select"
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
          {chosen === "full_auto" ? (
            <div>
              Full auto. A local checkpoint is saved before each turn. Review files in Changes.
            </div>
          ) : null}
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
  if (option.category === "model" || option.category === "effort") {
    return (
      <div
        className="ui-field"
        data-testid="picker-option"
        data-test-option-id={option.id}
        data-test-saving={String(saving !== null)}
        data-test-value={saving?.type === "choice" ? saving.value : current}
      >
        <span className="picker-option-label">{label}</span>
        <PickerChoices
          label={option.name}
          choices={choices}
          value={saving?.type === "choice" ? saving.value : current}
          enabled={enabled}
          effort={option.category === "effort"}
          onChoose={(value) => onSet(option.id, { type: "choice", value })}
        />
      </div>
    );
  }
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
        className="g-select"
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

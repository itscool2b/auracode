import { AgentMark } from "@auracode/ui/graphite";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, useId } from "react";
import type {
  AgentEntry,
  Autonomy,
  ConfigOption,
  ConfigValue,
  SessionLists,
  SessionStatus,
} from "../../bindings";
import { agentLineup } from "../../lib/chat/agentLineup";
import { AUTONOMIES, autonomyLabel, orderedOptions, pendingLabel } from "../../lib/chat/present";
import { agentVersion } from "../../lib/format";
import { focusPickerChoice, movePickerFocus, PickerChoices } from "./PickerChoices";
import { closePopover, Popover } from "./Popover";

/**
 * The autonomy level as three square ticks, 4, 6 and 8px tall (6.11): Ask fills one, Auto-edit
 * two, Full auto three. Decorative; the words beside it, or the control's name, say the level.
 */
export function AutonomyGlyph({ autonomy }: { readonly autonomy: Autonomy }) {
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
 * One popover for everything the next turn runs with (Grok's voice popover): the agent and the
 * model as rows, then effort as a segmented row and autonomy as a compact field, with the checkpoint
 * note under it. Options are enabled while the agent is ready or working; autonomy always applies
 * when the agent starts. A change on its way (up to 35 s) shows the value asked for, marked
 * "saving", instead of snapping back to the old one.
 *
 * Keys: Ctrl or Cmd + . opens it on the current choice; up and down move within a part, left and
 * right move between parts, Enter chooses, digits set the effort, letters jump to agents.
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
  const others = options.filter(
    (option) => option.category !== "model" && option.category !== "effort",
  );
  // The agents worth offering: one per product, plus the chat's own agent wherever it stands.
  const offered = agents?.length
    ? [
        ...(agent && !agentLineup(agents).products.some((entry) => entry.id === agent.id)
          ? [agent]
          : []),
        ...agentLineup(agents).products,
      ]
    : [];
  return (
    <div className="chat-pickers">
      <Popover
        label="Agent and model"
        triggerLabel={[
          agent?.name ?? "Agent",
          model && choiceLabel(model),
          effort && choiceLabel(effort),
          `${autonomyLabel(chosen)}.`,
          "Agent and model",
        ]
          .filter(Boolean)
          .join(" ")}
        tip={`Agent, model and autonomy (${typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl"} .)`}
        shortcut="."
        className="chat-model-popover"
        trigger={
          // Grok's chip: who answers and with what, then how freely (the autonomy ticks). The
          // agent's mark stays out: its code would be visible text missing from the chip's name.
          <>
            <strong>{agent?.name ?? "Agent"}</strong>{" "}
            {model ? <span className="chat-pill-model">{choiceLabel(model)}</span> : null}
            <span className="chat-pill-autonomy">
              <AutonomyGlyph autonomy={chosen} />
            </span>
            <ChevronDown size={12} />
          </>
        }
      >
        <fieldset
          className="chat-model-columns"
          aria-label="Agent, model and effort"
          onKeyDown={(event) => {
            if (
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.target instanceof HTMLSelectElement
            )
              return;
            const parts = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(":scope > section"),
            ].filter((part) => part.querySelector("button:not(:disabled)"));
            const part = (event.target as HTMLElement).closest<HTMLElement>(
              ".chat-model-columns > section",
            );
            const index = part ? parts.indexOf(part) : 0;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const next =
                parts[
                  (index + (event.key === "ArrowRight" ? 1 : -1) + parts.length) % parts.length
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
          <section aria-labelledby={`${autonomyId}-agent`}>
            <h3 id={`${autonomyId}-agent`}>Agent</h3>
            {offered.length && onChooseAgent ? (
              <fieldset
                className="chat-agent-choices"
                aria-label="Agents"
                onKeyDown={movePickerFocus}
              >
                {offered.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={entry.id === agent?.id}
                    data-agent-key={AGENT_KEYS[entry.id]}
                    disabled={entry.availability.state !== "ready"}
                    onClick={(event) => {
                      if (entry.id !== agent?.id) {
                        closePopover(event.currentTarget);
                        onChooseAgent(entry.id);
                      }
                    }}
                  >
                    <AgentMark agent={entry.id} size={16} />
                    <span className="picker-choice-copy">
                      <strong>{entry.name}</strong>
                    </span>
                    <small>
                      {entry.availability.state === "ready"
                        ? entry.availability.version === null
                          ? "Installed"
                          : agentVersion(entry.name, entry.availability.version)
                        : entry.availability.state.replaceAll("_", " ")}
                    </small>
                    {entry.id === agent?.id ? <Check size={14} aria-label="Selected" /> : null}
                  </button>
                ))}
              </fieldset>
            ) : (
              <span className="chat-current-agent">
                <AgentMark agent={agent?.id ?? "generic"} size={16} />
                {agent?.name ?? "Agent"}
              </span>
            )}
          </section>
          <section aria-labelledby={`${autonomyId}-model`}>
            <h3 id={`${autonomyId}-model`}>Model</h3>
            {!model ? (
              <p className="chat-picker-empty">
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
          <section className="chat-picker-fields" aria-labelledby={`${autonomyId}-effort`}>
            <h3 id={`${autonomyId}-effort`} className="sr-only">
              Effort and autonomy
            </h3>
            <div className="chat-picker-field">
              <span className="chat-picker-field-label">Effort</span>
              {effort ? null : (
                <span className="chat-picker-empty">
                  {optionsEnabled ? "Not offered" : "After the session starts"}
                </span>
              )}
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
            </div>
            <div className="chat-picker-field">
              <label htmlFor={autonomyId} className="chat-picker-field-label">
                Autonomy
                {autonomySaving !== null ? <span className="ui-muted"> (saving…)</span> : null}
              </label>
              <span className="chat-autonomy-select">
                <AutonomyGlyph autonomy={chosen} />
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
              </span>
            </div>
            <div className="chat-picker-note">
              {chosen === "full_auto" ? (
                <p>
                  Full auto. A local checkpoint is saved before each turn. Review files in Changes.
                </p>
              ) : null}
              {lists?.autonomy.note ? <p>{lists.autonomy.note}</p> : null}
              {lists?.autonomy.native_mode ? <p>Agent mode: {lists.autonomy.native_mode}</p> : null}
              {error !== null ? (
                <p role="alert" className="ui-error" data-testid="picker-error">
                  {error}
                </p>
              ) : null}
            </div>
            {others.length ? (
              <details className="chat-other-options">
                <summary>More options</summary>
                {others.map((option) => (
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
      </Popover>
      {error !== null ? (
        <span
          className="chat-picker-error-dot"
          role="img"
          aria-label="Session settings error. Open the agent and model picker for details."
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
      <div className="ui-field chat-picker-toggle">
        <label htmlFor={id} title={option.description ?? undefined}>
          <input
            id={id}
            type="checkbox"
            className="g-switch"
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
    const effort = option.category === "effort";
    return (
      <div
        className="ui-field"
        data-testid="picker-option"
        data-test-option-id={option.id}
        data-test-saving={String(saving !== null)}
        data-test-value={saving?.type === "choice" ? saving.value : current}
        data-layout={effort ? "segments" : "rows"}
      >
        {saving !== null || pending !== null ? (
          <span className="picker-option-label">{label}</span>
        ) : (
          <span className="sr-only">{label}</span>
        )}
        <PickerChoices
          label={option.name}
          choices={choices}
          value={saving?.type === "choice" ? saving.value : current}
          enabled={enabled}
          effort={effort}
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
    <div className="ui-field chat-picker-field">
      <label
        htmlFor={id}
        className="chat-picker-field-label"
        title={option.description ?? undefined}
      >
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

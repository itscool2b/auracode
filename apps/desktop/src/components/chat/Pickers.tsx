import { AgentMark } from "@auracode/ui/graphite";
import { Check, ChevronDown, Search } from "lucide-react";
import { Fragment, useId, useState } from "react";
import type {
  AgentEntry,
  Autonomy,
  ConfigOption,
  ConfigValue,
  SessionControlChange,
  SessionLists,
  SessionStatus,
} from "../../bindings";
import { agentLineup } from "../../lib/chat/agentLineup";
import { orderedOptions, pendingLabel } from "../../lib/chat/present";
import { agentVersion } from "../../lib/format";
import { AccessPicker } from "./AccessPicker";
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
 * Access and native workflow controls sit beside a searchable agent, model and effort picker.
 * Live descriptors determine the choices. Pending changes keep the requested value visible.
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
  controlSaving = null,
  transitionBlocked = false,
  onSetAutonomy,
  onSetOption,
  agent = null,
  agents,
  onChooseAgent,
  onSetControl,
}: {
  readonly lists: SessionLists | null;
  /** The chat's autonomy until the lists arrive. */
  readonly autonomy: Autonomy;
  readonly status: SessionStatus;
  readonly error: string | null;
  /** Option changes on their way, by option id. */
  readonly optionsSaving?: ReadonlyMap<string, ConfigValue>;
  readonly autonomySaving?: Autonomy | null;
  readonly controlSaving?: SessionControlChange | null;
  readonly transitionBlocked?: boolean;
  readonly onSetAutonomy: (autonomy: Autonomy) => void;
  readonly onSetOption: (optionId: string, value: ConfigValue) => void;
  readonly agent?: AgentEntry | null;
  readonly agents?: readonly AgentEntry[] | null;
  readonly onChooseAgent?: (id: string) => void;
  readonly onSetControl?: (change: SessionControlChange) => void;
}) {
  const autonomyId = useId();
  const [query, setQuery] = useState("");
  const optionsEnabled = status === "ready" || status === "running";
  const options = orderedOptions(lists?.options ?? []).filter(
    (option) => !["aura.access", "aura.workflow"].includes(option.id),
  );
  const choiceLabel = (option: ConfigOption) =>
    option.kind.type === "select"
      ? (option.kind.choices.find((choice) => choice.value === option.kind.current)?.name ?? null)
      : null;
  const model = options.find((option) => option.category === "model");
  const effort = options.find((option) => option.category === "effort");
  const modelLabel = (model && choiceLabel(model)) ?? agent?.name ?? "Choose model";
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
  const matchingAgents = offered.filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="chat-pickers">
      <AccessPicker
        lists={lists}
        autonomy={autonomy}
        saving={autonomySaving}
        controlSaving={controlSaving}
        transitionBlocked={transitionBlocked}
        status={status}
        error={error}
        onSetAutonomy={onSetAutonomy}
        onSetControl={onSetControl}
      />
      <Popover
        label="Agent and model"
        triggerLabel={[agent?.name, modelLabel, effort && choiceLabel(effort), "Agent and model"]
          .filter(Boolean)
          .join(" ")}
        tip={`Agent, model and effort (${typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl"} .)`}
        shortcut="."
        className="chat-model-popover"
        onOpenChange={(open) => {
          if (!open) setQuery("");
        }}
        trigger={
          <>
            {agent ? (
              <span aria-hidden="true">
                <AgentMark agent={agent.id} size={14} />
              </span>
            ) : null}
            <strong className="chat-pill-model">{modelLabel}</strong>
            {effort ? (
              <>
                {" "}
                <span className="chat-pill-effort">{choiceLabel(effort)}</span>
              </>
            ) : null}
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
              event.target instanceof HTMLSelectElement ||
              event.target instanceof HTMLInputElement
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
          <label className="chat-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              className="g-input"
              aria-label="Search agents and models"
              placeholder="Search agents and models…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <section aria-labelledby={`${autonomyId}-agent`}>
            <h3 id={`${autonomyId}-agent`}>Agent</h3>
            {offered.length && onChooseAgent ? (
              <fieldset
                className="chat-agent-choices"
                aria-label="Agents"
                onKeyDown={movePickerFocus}
              >
                {matchingAgents.map((entry) => (
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
                {!matchingAgents.length ? (
                  <p className="chat-picker-empty">No matching agents.</p>
                ) : null}
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
                  query={query}
                />
              ))}
          </section>
          <section className="chat-picker-fields" aria-labelledby={`${autonomyId}-effort`}>
            <h3 id={`${autonomyId}-effort`} className="sr-only">
              Reasoning effort
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
          aria-label="Session settings error. Open the access picker for details."
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
  query = "",
}: {
  readonly option: ConfigOption;
  /** The value a change on its way asked for. */
  readonly saving: ConfigValue | null;
  readonly enabled: boolean;
  readonly onSet: (optionId: string, value: ConfigValue) => void;
  readonly query?: string;
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
    const matching = choices.filter((choice) =>
      `${choice.name} ${choice.group ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
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
          choices={matching}
          value={saving?.type === "choice" ? saving.value : current}
          enabled={enabled}
          effort={effort}
          onChoose={(value) => onSet(option.id, { type: "choice", value })}
        />
        {!matching.length && query ? (
          <p className="chat-picker-empty">No matching models.</p>
        ) : null}
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
